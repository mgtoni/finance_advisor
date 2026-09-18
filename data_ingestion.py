import os
import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
from edgar import set_identity, get_filings
from dotenv import load_dotenv
from utils import get_yf_ticker

load_dotenv()

class DataIngestionService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        # edgartools requires an identity to be set to avoid rate limits
        edgar_identity = os.getenv("EDGAR_IDENTITY", "User Name (user@example.com)")
        set_identity(edgar_identity)

    def update_daily_closes(self, tickers):
        """Updates the last_close_price in the Supabase tickers table using Alpaca real-time data, fallback to yfinance."""
        import requests
        alpaca_key = os.getenv("ALPACA_API_KEY")
        alpaca_secret = os.getenv("ALPACA_SECRET_KEY")
        
        updates = []
        alpaca_prices = {}
        
        # Attempt to get bulk real-time prices from Alpaca
        if alpaca_key and alpaca_secret:
            try:
                headers = {
                    "APCA-API-KEY-ID": alpaca_key,
                    "APCA-API-SECRET-KEY": alpaca_secret
                }
                symbols_str = ",".join(tickers)
                url = f"https://data.alpaca.markets/v2/stocks/trades/latest?symbols={symbols_str}"
                response = requests.get(url, headers=headers)
                if response.status_code == 200:
                    data = response.json().get('trades', {})
                    for sym, trade in data.items():
                        alpaca_prices[sym] = trade.get('p')
            except Exception as e:
                print(f"Alpaca API error: {e}")

        for symbol in tickers:
            try:
                yf_symbol = get_yf_ticker(symbol)
                last_close = None
                
                # Use Alpaca price if available, else yfinance
                if symbol in alpaca_prices and alpaca_prices[symbol] is not None:
                    last_close = float(alpaca_prices[symbol])
                    print(f"Got real-time price for {symbol} from Alpaca: {last_close}")
                else:
                    ticker = yf.Ticker(yf_symbol)
                    history = ticker.history(period="1d")
                    if not history.empty:
                        last_close = float(history['Close'].iloc[-1])
                        print(f"Got fallback price for {symbol} from yfinance: {last_close}")
                
                if last_close is not None:
                    ticker = yf.Ticker(yf_symbol)
                    info = ticker.info
                    company_name = info.get('longName', '') or info.get('shortName', '')
                    currency = info.get('currency', 'USD')
                    
                    if currency == 'GBp':
                        last_close = last_close / 100.0
                        currency = 'GBP'
                        
                    if currency != 'USD':
                        fx_ticker = f"{currency}USD=X"
                        try:
                            fx_data = yf.Ticker(fx_ticker).history(period="1d")
                            if not fx_data.empty:
                                fx_rate = float(fx_data['Close'].iloc[-1])
                                last_close = last_close * fx_rate
                                print(f"Converted current price for {symbol} from {currency} to USD using rate {fx_rate}")
                        except Exception as fx_err:
                            print(f"Error fetching current FX for {fx_ticker}: {fx_err}")

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
                    print(f"Updated {symbol} with close price {last_close} USD")
                else:
                    print(f"No price data found for {symbol}")
            except Exception as e:
                print(f"Error fetching close for {symbol}: {e}")
        return updates

    def get_macro_regime(self):
        """Fetches 10Y Yield, VIX, Yield Curve (10Y-3M), Commodities, FX, and Credit Spreads."""
        macro = {}
        try:
            # Traditional Macro
            macro['vix'] = float(yf.Ticker('^VIX').history(period="1d")['Close'].iloc[-1])
            tnx = float(yf.Ticker('^TNX').history(period="1d")['Close'].iloc[-1])
            macro['treasury_10y_yield'] = tnx
            
            # Yield Curve: 10Y (^TNX) minus 3-Month (^IRX)
            irx = float(yf.Ticker('^IRX').history(period="1d")['Close'].iloc[-1])
            macro['yield_curve_10y_3m'] = tnx - irx
            
            # Commodities
            macro['gold'] = float(yf.Ticker('GLD').history(period="1d")['Close'].iloc[-1])
            macro['oil'] = float(yf.Ticker('USO').history(period="1d")['Close'].iloc[-1])
            macro['brent_oil'] = float(yf.Ticker('BZ=F').history(period="1d")['Close'].iloc[-1])
            
            copper = float(yf.Ticker('HG=F').history(period="1d")['Close'].iloc[-1])
            gold_futures = float(yf.Ticker('GC=F').history(period="1d")['Close'].iloc[-1])
            macro['copper_gold_ratio'] = copper / gold_futures if gold_futures > 0 else None
            
            # Global Equities & Risk
            macro['msci_world'] = float(yf.Ticker('URTH').history(period="1d")['Close'].iloc[-1])
            macro['btc_usd'] = float(yf.Ticker('BTC-USD').history(period="1d")['Close'].iloc[-1])
            
            # FX
            macro['usd_index'] = float(yf.Ticker('UUP').history(period="1d")['Close'].iloc[-1])
            macro['eur_usd'] = float(yf.Ticker('EURUSD=X').history(period="1d")['Close'].iloc[-1])
            
            # Credit Spread (High Yield vs Investment Grade)
            hyg = float(yf.Ticker('HYG').history(period="1d")['Close'].iloc[-1])
            lqd = float(yf.Ticker('LQD').history(period="1d")['Close'].iloc[-1])
            macro['credit_spread_hyg_lqd_ratio'] = hyg / lqd if lqd > 0 else None
            
        except Exception as e:
            print(f"Error fetching extended macro regime: {e}")
            
        return macro

    def get_economic_calendar(self, symbols=None):
        """Fetches upcoming high-impact economic events from ForexFactory JSON API and filters by portfolio exposure."""
        import requests
        import time
        
        # Check global cache to prevent 429 rate limit
        global _CALENDAR_CACHE, _CALENDAR_CACHE_TIME
        if '_CALENDAR_CACHE' not in globals():
            _CALENDAR_CACHE = None
            _CALENDAR_CACHE_TIME = 0
            
        if _CALENDAR_CACHE and (time.time() - _CALENDAR_CACHE_TIME) < 3600:
            events = _CALENDAR_CACHE
        else:
            try:
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                res = requests.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json", headers=headers, timeout=5)
                if res.status_code == 200:
                    events = res.json()
                    _CALENDAR_CACHE = events
                    _CALENDAR_CACHE_TIME = time.time()
                else:
                    events = []
            except Exception as e:
                print(f"Error fetching economic calendar: {e}")
                events = []

        if events:
            try:
                high_impact = [e for e in events if e.get('impact') == 'High']
                
                # Filter by portfolio exposure
                if symbols:
                    allowed_currencies = {'USD', 'All'}
                    for sym in symbols:
                        sym = sym.upper()
                        if sym.endswith('.L'): allowed_currencies.add('GBP')
                        elif sym.endswith('.NV') or sym.endswith('.MI') or sym.endswith('.DE') or sym.endswith('.PA') or sym.endswith('.AS'): allowed_currencies.add('EUR')
                        elif sym.endswith('.OL'): allowed_currencies.add('NOK')
                        elif sym.endswith('.TO'): allowed_currencies.add('CAD')
                        elif sym.endswith('.AX'): allowed_currencies.add('AUD')
                        elif sym.endswith('.HK'): allowed_currencies.add('HKD')
                        elif sym.endswith('.T'): allowed_currencies.add('JPY')
                        elif sym.endswith('.SZ') or sym.endswith('.SS'): allowed_currencies.add('CNY')
                    
                    high_impact = [e for e in high_impact if e.get('country') in allowed_currencies]

                # Return the top 5 upcoming high impact events
                return [{'title': h['title'], 'country': h['country'], 'date': h['date']} for h in high_impact[:5]]
            except Exception as e:
                print(f"Error fetching economic calendar: {e}")
        return []

    def get_earnings_drift(self, symbol):
        """Attempts to detect earnings drift via yfinance."""
        try:
            yf_symbol = get_yf_ticker(symbol)
            ticker = yf.Ticker(yf_symbol)
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
                yf_symbol = get_yf_ticker(symbol)
                ticker = yf.Ticker(yf_symbol)
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
        calendar = self.get_economic_calendar()
        
        # Add calendar to macro object so it's passed smoothly to the AI
        macro['economic_calendar'] = calendar
        
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
