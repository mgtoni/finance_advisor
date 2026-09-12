import os
import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
from edgar import set_identity, get_filings
from dotenv import load_dotenv

load_dotenv()

class DataIngestionService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        # edgartools requires an identity to be set to avoid rate limits
        edgar_identity = os.getenv("EDGAR_IDENTITY", "User Name (user@example.com)")
        set_identity(edgar_identity)

    def update_daily_closes(self, tickers):
        """Updates the last_close_price in the Supabase tickers table."""
        updates = []
        for symbol in tickers:
            try:
                ticker = yf.Ticker(symbol)
                history = ticker.history(period="1d")
                if not history.empty:
                    last_close = float(history['Close'].iloc[-1])
                    info = ticker.info
                    company_name = info.get('longName', '') or info.get('shortName', '')
                    if self.supabase:
                        try:
                            self.supabase.table('tickers').update({
                                'last_close_price': last_close,
                                'company_name': company_name
                            }).eq('symbol', symbol).execute()
                        except Exception as db_err:
                            print(f"Error updating DB with company_name for {symbol}. (Did you add the company_name column?). Falling back to just price. Error: {db_err}")
                            self.supabase.table('tickers').update({'last_close_price': last_close}).eq('symbol', symbol).execute()
                    updates.append({'symbol': symbol, 'last_close': last_close, 'company_name': company_name})
                    print(f"Updated {symbol} with close price {last_close}")
                else:
                    print(f"No price data found for {symbol}")
            except Exception as e:
                print(f"Error fetching close for {symbol}: {e}")
        return updates

    def get_macro_regime(self):
        """Fetches 10Y Treasury Yield and VIX."""
        # While FRED is great, yfinance provides free access to ^TNX (10Y Yield) and ^VIX without API keys.
        try:
            vix_ticker = yf.Ticker('^VIX')
            vix_close = vix_ticker.history(period="1d")['Close'].iloc[-1]
            
            tnx_ticker = yf.Ticker('^TNX')
            tnx_close = tnx_ticker.history(period="1d")['Close'].iloc[-1]
            
            return {
                'vix': float(vix_close),
                'treasury_10y_yield': float(tnx_close)
            }
        except Exception as e:
            print(f"Error fetching macro regime: {e}")
            return {'vix': None, 'treasury_10y_yield': None}

    def get_earnings_drift(self, symbol):
        """Attempts to detect earnings drift via yfinance."""
        try:
            ticker = yf.Ticker(symbol)
            # yfinance sometimes exposes eps trend data
            eps_trend = ticker.eps_trend
            if eps_trend is not None and not eps_trend.empty:
                # This is an approximation based on available yfinance data
                # Typically index might be 'Current', '7 Days Ago', '30 Days Ago'
                if '30dAgo' in eps_trend.columns and 'current' in eps_trend.columns:
                    # simplified extraction
                    pass 
                
            # Fallback: Just get current trailing PE vs forward PE or similar if drift isn't directly available
            info = ticker.info
            forward_eps = info.get('forwardEps')
            trailing_eps = info.get('trailingEps')
            
            return {
                'forward_eps': forward_eps,
                'trailing_eps': trailing_eps,
                'drift_proxy': (forward_eps - trailing_eps) / trailing_eps if forward_eps and trailing_eps else None
            }
        except Exception as e:
            print(f"Error fetching earnings drift for {symbol}: {e}")
            return None

    def get_insider_tracking(self, symbol, days_back=7):
        """Scans SEC Form 4 filings or yfinance insider data for executive cluster buying."""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        # Note: edgartools works best for US tickers. For non-US (e.g. LSE, Euronext), we fall back to yfinance.
        if '.' in symbol:
            try:
                # Use Yahoo Finance global insider transactions as fallback
                ticker = yf.Ticker(symbol)
                insider_tx = ticker.insider_transactions
                
                buy_count = 0
                if insider_tx is not None and not insider_tx.empty:
                    # Filter for transactions within the days_back window
                    if 'Start Date' in insider_tx.columns:
                        recent_tx = insider_tx[pd.to_datetime(insider_tx['Start Date'], errors='coerce') >= pd.to_datetime(start_date)]
                        buy_count = len(recent_tx)
                
                return {
                    'insider_filings_count': buy_count,
                    'days_scanned': days_back,
                    'note': 'Used yfinance global insider data'
                }
            except Exception as e:
                print(f"Error fetching global insider tracking for {symbol}: {e}")
                return {'insider_filings_count': 0, 'error': str(e)}
            
        try:
            # US Tickers: We look for Form 4 filings in the recent past
            start_date_str = start_date.strftime('%Y-%m-%d')
            
            # This fetches Form 4s. edgartools allows querying by company
            from edgar import Company
            company = Company(symbol)
            
            # get_filings() on Company does not take a date parameter directly,
            # but we can filter the result
            filings = company.get_filings(form="4")
            
            buy_count = 0
            if filings:
                # filter by date manually if needed, edgartools Filings object allows .filter(date="...")
                # but for simplicity we can just rely on the recent list or use its filter method.
                try:
                    recent_filings = filings.filter(date=f"{start_date_str}:")
                    buy_count = len(recent_filings)
                except Exception as e:
                    # fallback if filter syntax fails
                    buy_count = len(filings)
                
            return {
                'insider_filings_count': buy_count,
                'days_scanned': days_back
            }
        except Exception as e:
            print(f"Error fetching SEC insider tracking for {symbol}: {e}")
            return {'insider_filings_count': 0, 'error': str(e)}

    def run_ingestion(self, tickers):
        print("Starting Data Ingestion...")
        price_updates = self.update_daily_closes(tickers)
        macro = self.get_macro_regime()
        
        alpha_data = {}
        for symbol in tickers:
            drift = self.get_earnings_drift(symbol)
            insider = self.get_insider_tracking(symbol)
            alpha_data[symbol] = {
                'earnings_drift': drift,
                'insider_tracking': insider
            }
            
        print("Data Ingestion Complete.")
        return {
            'prices': price_updates,
            'macro': macro,
            'alpha': alpha_data
        }

if __name__ == "__main__":
    # Test execution
    test_tickers = ['MU', 'WDC']
    service = DataIngestionService()
    results = service.run_ingestion(test_tickers)
    import pprint
    pprint.pprint(results)
