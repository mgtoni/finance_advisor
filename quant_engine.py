import yfinance as yf
import pandas as pd
import pandas_ta as ta
from utils import get_yf_ticker

class QuantEngineService:
    def __init__(self):
        pass

    def fetch_data(self, symbol, interval="1d", period="2y"):
        """Fetches historical OHLCV data."""
        try:
            yf_symbol = get_yf_ticker(symbol)
            ticker = yf.Ticker(yf_symbol)
            df = ticker.history(period=period, interval=interval)
            if df.empty:
                return None
            
            # Lowercase columns for pandas_ta convention or keep them capitalized
            # pandas_ta works with default yfinance OHLCV columns
            return df
        except Exception as e:
            print(f"Error fetching data for {symbol}: {e}")
            return None

    def analyze_timeframe(self, df):
        """Runs pandas-ta indicators and generates a score for a single timeframe."""
        if df is None or len(df) < 50:
            return 0.0

        score = 0.0
        
        # 1. Regime Detection (ADX/DMI)
        # By default length=14
        adx = df.ta.adx()
        if adx is not None and not adx.empty:
            current_adx = adx[adx.columns[0]].iloc[-1]
            current_dmp = adx[adx.columns[1]].iloc[-1] # DI+
            current_dmn = adx[adx.columns[2]].iloc[-1] # DI-
            
            if current_adx > 25: # Trending regime
                if current_dmp > current_dmn:
                    score += 0.3 # Strong uptrend
                else:
                    score -= 0.3 # Strong downtrend

        # 2. Volatility Squeeze (TTM Squeeze -> BB inside KC)
        squeeze = df.ta.squeeze()
        if squeeze is not None and not squeeze.empty:
            # Squeeze 'SQZ_20_2.0_20_1.5' usually returns a dataframe with squeeze ON/OFF and histogram
            # Check if squeeze is firing (momentum)
            # Typically columns are SQZ_ON, SQZ_OFF, SQZ_NO, SQZ_PRO, etc depending on version
            # The histogram indicates direction of breakout
            hist_col = [c for c in squeeze.columns if 'SQZ' in c and not ('ON' in c or 'OFF' in c or 'NO' in c)][0]
            current_hist = squeeze[hist_col].iloc[-1]
            
            if current_hist > 0:
                score += 0.3
            elif current_hist < 0:
                score -= 0.3

        # 3. Smart Money Divergence (OBV and PVT)
        obv = df.ta.obv()
        pvt = df.ta.pvt()
        
        if obv is not None and not obv.empty and pvt is not None and not pvt.empty:
            # Simple momentum check on OBV and PVT vs Price
            price_roc = df['Close'].pct_change(10).iloc[-1]
            obv_roc = obv.pct_change(10).iloc[-1]
            pvt_roc = pvt.pct_change(10).iloc[-1]
            
            if obv_roc > price_roc and pvt_roc > price_roc:
                score += 0.4 # Strong underlying accumulation
            elif obv_roc < price_roc and pvt_roc < price_roc:
                score -= 0.4 # Strong underlying distribution

        # Clamp score between -1.0 and 1.0
        return max(min(score, 1.0), -1.0)

    def calculate_composite_score(self, symbol):
        """Calculates a composite technical score using Daily and Weekly timeframes."""
        
        daily_df = self.fetch_data(symbol, interval="1d", period="2y")
        weekly_df = self.fetch_data(symbol, interval="1wk", period="2y")
        
        if daily_df is None or weekly_df is None:
            return {
                'composite_score': 0.0,
                'daily_score': 0.0,
                'weekly_score': 0.0
            }
            
        daily_score = self.analyze_timeframe(daily_df)
        weekly_score = self.analyze_timeframe(weekly_df)
        
        # Weighting: 60% Daily, 40% Weekly (or 50/50)
        composite_score = (daily_score * 0.6) + (weekly_score * 0.4)
        
        return {
            'composite_score': max(min(composite_score, 1.0), -1.0),
            'daily_score': daily_score,
            'weekly_score': weekly_score
        }

    def run_quant_engine(self, tickers):
        print("Starting Quantitative Analysis...")
        results = {}
        for symbol in tickers:
            scores = self.calculate_composite_score(symbol)
            results[symbol] = scores
            print(f"{symbol} Tech Score: {scores['composite_score']:.2f} (D: {scores['daily_score']:.2f}, W: {scores['weekly_score']:.2f})")
            
        print("Quantitative Analysis Complete.")
        return results

if __name__ == "__main__":
    # Test execution
    test_tickers = ['MU', 'WDC']
    engine = QuantEngineService()
    scores = engine.run_quant_engine(test_tickers)
