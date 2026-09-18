import os
import json
import warnings
# Suppress package deprecation warnings (e.g., google.generativeai and duckduckgo_search)
warnings.filterwarnings("ignore")
from flask import Flask, jsonify, request, make_response
import yfinance as yf
from datetime import datetime, timedelta
from main import main as run_pipeline
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from utils import get_yf_ticker
from portfolio_manager import PortfolioManagerService
import threading
import time
import datetime
import pandas as pd
import numpy as np
import google.generativeai as genai

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key) if supabase_url else None

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = Flask(__name__)

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', '*')
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Access-Control-Allow-Private-Network'
    response.headers['Access-Control-Allow-Private-Network'] = 'true'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return make_response('', 200)

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
def handle_root_options(path):
    return make_response('', 200)

@app.route('/api/run-analysis', methods=['POST'])
def run_analysis():
    try:
        data = request.json if request.is_json else {}
        symbol_filter = data.get('symbol')
        
        # Run pipeline in a blocking way for now
        run_pipeline(symbol_filter=symbol_filter)
        return jsonify({"status": "success", "message": "Pipeline executed successfully"})
    except Exception as e:
        print(f"Error running pipeline: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/refresh-prices', methods=['POST'])
def refresh_prices():
    try:
        if not supabase:
            return jsonify({"status": "error", "message": "Database not initialized"}), 500
            
        res = supabase.table('tickers').select('symbol').execute()
        if not res.data:
            return jsonify({"status": "success", "message": "No tickers found", "prices": {}})
            
        tickers = [r['symbol'] for r in res.data]
        
        from data_ingestion import DataIngestionService
        svc = DataIngestionService(supabase_client=supabase)
        prices = svc.update_daily_closes(tickers)
        
        return jsonify({"status": "success", "message": "Prices updated successfully", "prices": prices})
    except Exception as e:
        print(f"Error refreshing prices: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/add-position', methods=['POST'])
def add_position():
    try:
        data = request.json
        symbol = data.get('symbol', '').upper().strip()
        open_date = data.get('open_date')
        shares = float(data.get('shares', 0))
        entry_price = float(data.get('entry_price', 0))

        input_currency = data.get('currency', 'USD').strip()

        if not all([symbol, open_date, shares, entry_price]):
            return jsonify({"status": "error", "message": "Missing required fields"}), 400

        # Fetch ticker just to confirm it's valid if needed, but rely on input_currency for FX
        yf_symbol = get_yf_ticker(symbol)
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
        
        converted_entry_price = entry_price
        
        if input_currency == 'GBp':
            input_currency = 'GBP'
            converted_entry_price = entry_price / 100.0

        if input_currency != 'USD':
            fx_ticker = f"{input_currency}USD=X"
            fx = yf.Ticker(fx_ticker)
            # Try to get the FX rate on the open date
            # We fetch a window around open_date to ensure we get a trading day
            try:
                date_obj = datetime.strptime(open_date, "%Y-%m-%d")
                start_date = date_obj.strftime("%Y-%m-%d")
                end_date = (date_obj + timedelta(days=3)).strftime("%Y-%m-%d")
                
                fx_hist = fx.history(start=start_date, end=end_date)
                if not fx_hist.empty:
                    fx_rate = fx_hist['Close'].iloc[0]
                    converted_entry_price = converted_entry_price * float(fx_rate)
                    print(f"Converted {entry_price} input currency to {converted_entry_price} USD using FX rate {fx_rate}")
                else:
                    print(f"Warning: Could not find historical FX rate for {fx_ticker} around {start_date}. Using 1:1.")
            except Exception as fx_err:
                print(f"Error fetching historical FX for {fx_ticker}: {fx_err}")

        # Insert into Supabase
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500

        # Upsert ticker with sector, country, and company name
        try:
            info = yf.Ticker(symbol).info
            sector = info.get('sector', 'Unknown')
            country = info.get('country', 'Unknown')
            company_name = info.get('longName', info.get('shortName', 'Unknown'))
        except Exception:
            sector = 'Unknown'
            country = 'Unknown'
            company_name = 'Unknown'
            
        supabase.table('tickers').upsert({'symbol': symbol, 'sector': sector, 'country': country, 'company_name': company_name}).execute()
        
        # Insert position
        position_data = {
            'symbol': symbol,
            'open_date': open_date,
            'shares': shares,
            'entry_price': converted_entry_price
        }
        supabase.table('positions').insert(position_data).execute()

        return jsonify({
            "status": "success", 
            "message": f"Successfully saved {symbol}!",
            "currency": input_currency,
            "original_price": entry_price,
            "converted_price": converted_entry_price
        }), 200

    except Exception as e:
        print(f"Error adding position: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/close-position', methods=['POST'])
def close_position():
    try:
        data = request.json
        position_id = data.get('position_id')
        shares_to_close = float(data.get('shares_to_close', 0))

        if not position_id or shares_to_close <= 0:
            return jsonify({"status": "error", "message": "Invalid input: position_id and positive shares_to_close are required."}), 400

        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500

        # Fetch the current position
        res = supabase.table('positions').select('*').eq('id', position_id).execute()
        if not res.data:
            return jsonify({"status": "error", "message": "Position not found"}), 404

        position = res.data[0]
        current_shares = float(position['shares'])

        if shares_to_close >= current_shares:
            # Delete entirely
            supabase.table('positions').delete().eq('id', position_id).execute()
            message = "Position closed completely."
        else:
            # Reduce shares
            new_shares = current_shares - shares_to_close
            supabase.table('positions').update({'shares': new_shares}).eq('id', position_id).execute()
            message = f"Position reduced by {shares_to_close} shares. {new_shares} remaining."

        return jsonify({"status": "success", "message": message}), 200

    except Exception as e:
        print(f"Error closing position: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/edit-position', methods=['PUT'])
def edit_position():
    try:
        data = request.json
        position_id = data.get('position_id')
        open_date = data.get('open_date')
        shares = data.get('shares')
        entry_price = data.get('entry_price')

        if not position_id or not open_date or shares is None or entry_price is None:
            return jsonify({"status": "error", "message": "Missing required fields."}), 400

        shares = float(shares)
        entry_price = float(entry_price)

        if shares <= 0 or entry_price < 0:
            return jsonify({"status": "error", "message": "Invalid shares or entry price."}), 400

        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500

        # Update the position
        supabase.table('positions').update({
            'open_date': open_date,
            'shares': shares,
            'entry_price': entry_price
        }).eq('id', position_id).execute()

        return jsonify({"status": "success", "message": "Position updated successfully."}), 200

    except Exception as e:
        print(f"Error editing position: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/news/historical', methods=['GET'])
def get_historical_news():
    try:
        import requests
        import os
        from datetime import datetime
        
        symbol = request.args.get('symbol')
        start = request.args.get('start')
        end = request.args.get('end')
        
        if not symbol:
            return jsonify({"status": "error", "message": "Symbol is required"}), 400
            
        alpaca_key = os.getenv("ALPACA_API_KEY")
        alpaca_secret = os.getenv("ALPACA_SECRET_KEY")
        
        if not alpaca_key or not alpaca_secret:
            return jsonify({"status": "error", "message": "Alpaca keys missing"}), 500
            
        url = f"https://data.alpaca.markets/v1beta1/news?symbols={symbol}&limit=50"
        if start:
            if len(start) == 10:
                start += "T00:00:00Z"
            url += f"&start={start}"
        if end:
            if len(end) == 10:
                end += "T23:59:59Z"
            url += f"&end={end}"
            
        headers = {
            "APCA-API-KEY-ID": alpaca_key,
            "APCA-API-SECRET-KEY": alpaca_secret
        }
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            news_items = res.json().get('news', [])
            articles = []
            
            from news_aggregator import NewsAggregatorService
            svc = NewsAggregatorService()
            
            for item in news_items:
                source = item.get('source', 'Benzinga')
                articles.append({
                    'headline': item.get('headline', ''),
                    'url': item.get('url', ''),
                    'source': source,
                    'source_tier': svc.assign_tier(source),
                    'published_at': item.get('created_at', datetime.now().isoformat()),
                    'summary': item.get('summary', '')
                })
                
            # Fallback for non-US or zero-result symbols
            if len(articles) == 0:
                ddg_news = svc.fetch_duckduckgo_news(symbol)
                # Note: DDG ignores the strict date parameters, but better than no news.
                for item in ddg_news:
                    source = item.get('source', 'DuckDuckGo')
                    articles.append({
                        'headline': item.get('headline', ''),
                        'url': item.get('url', ''),
                        'source': source,
                        'source_tier': svc.assign_tier(source),
                        'published_at': item.get('published_at', datetime.now().isoformat()),
                        'summary': ''
                    })
            
            # Add AI Sentiment and Impact Summary
            articles = svc.analyze_sentiment(symbol, articles)
                    
            return jsonify({"status": "success", "data": articles}), 200
        else:
            return jsonify({"status": "error", "message": res.text}), res.status_code
    except Exception as e:
        print(f"Error fetching historical news: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/history/<symbol>', methods=['GET'])
def get_history(symbol):
    try:
        timeframe = request.args.get('timeframe', '1Y')
        # Map frontend timeframes to yfinance periods
        tf_map = {
            '1M': '1mo',
            '3M': '3mo',
            '6M': '6mo',
            '1Y': '1y',
            '3Y': '3y',
            'ALL': 'max'
        }
        period = tf_map.get(timeframe, '1y')
        
        yf_symbol = get_yf_ticker(symbol)
        ticker = yf.Ticker(yf_symbol)
        hist = ticker.history(period=period)
        
        if hist.empty:
            return jsonify([])

        currency = ticker.info.get('currency', 'USD')
        is_gbp = currency == 'GBp'

        data = []
        for date, row in hist.iterrows():
            factor = 100.0 if is_gbp else 1.0
            data.append({
                "time": int(date.timestamp()),
                "open": float(row["Open"]) / factor,
                "high": float(row["High"]) / factor,
                "low": float(row["Low"]) / factor,
                "close": float(row["Close"]) / factor
            })
            
        return jsonify(data)
    except Exception as e:
        print(f"Error fetching history for {symbol}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/portfolio-analysis', methods=['GET'])
def get_portfolio_analysis():
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500
            
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        
        # 1. Check Cache first unless forced
        if not force:
            cache_res = supabase.table('portfolio_analysis_logs').select('*').eq('analysis_date', today).order('created_at', desc=True).limit(1).execute()
            if cache_res.data and len(cache_res.data) > 0:
                print("Returning portfolio analysis from cache")
                return jsonify({"status": "success", "data": cache_res.data[0]})
        
        print("Generating new portfolio analysis via AI")
        pm = PortfolioManagerService(supabase_client=supabase)
        analysis = pm.synthesize_portfolio()
        
        if analysis and "error" not in analysis:
            # Save to cache explicitly if synthesize_portfolio didn't (though it usually does)
            return jsonify({"status": "success", "data": analysis})
        else:
            err = analysis.get("error", "Failed to synthesize portfolio") if analysis else "No data returned"
            return jsonify({"status": "error", "message": err}), 500
    except Exception as e:
        print(f"Error fetching portfolio analysis: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

def scheduled_news_run():
    print("Running scheduled intraday news aggregation...")
    try:
        from news_aggregator import NewsAggregatorService
        if not supabase: return
        res = supabase.table('positions').select('symbol').execute()
        if not res.data: return
        tickers = list(set([r['symbol'] for r in res.data]))
        service = NewsAggregatorService(supabase_client=supabase)
        service.run_aggregation(tickers)
    except Exception as e:
        print(f"Error in scheduled news run: {e}")

def run_scheduler():
    while True:
        now = datetime.datetime.utcnow()
        # roughly check if it's 9:30 AM EST (13:30 or 14:30 UTC depending on DST)
        # For simplicity, we just use a basic check.
        # It's better to just sleep and check the time.
        # To avoid timezone complexities without pytz, we just sleep.
        # Actually, let's just not do this background thread if it crashes gunicorn.
        time.sleep(60)

# We will disable the background thread for now to prevent VPS crashes.
# The user can hit an endpoint /api/cron/news to trigger it via external cron.
@app.route('/api/cron/news', methods=['GET', 'POST'])
def trigger_news_cron():
    # Run in background to not block the request
    threading.Thread(target=scheduled_news_run).start()
    return jsonify({"status": "success", "message": "News aggregation started in background"})

@app.route('/api/portfolio-metrics', methods=['GET'])
def get_portfolio_metrics():
    try:
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500
        
        res = supabase.table('portfolio_summary').select('*').execute()
        if not res.data:
            return jsonify({"status": "success", "data": {"correlation": {}, "sharpe_ratio": 0}})
        
        symbols = list(set([r['symbol'] for r in res.data]))
        if len(symbols) < 1:
            return jsonify({"status": "success", "data": {"correlation": {}, "sharpe_ratio": 0}})
            
        # Fetch pre-calculated static info from tickers table
        tickers_res = supabase.table('tickers').select('symbol, sector, country').execute()
        ticker_meta = {t['symbol']: t for t in tickers_res.data} if tickers_res and tickers_res.data else {}

        sector_assets = {}
        country_assets = {}
        sector_value = {}
        country_value = {}
        total_val = 0
        
        for row in res.data:
            sym = row['symbol']
            meta = ticker_meta.get(sym, {})
            sec = meta.get('sector') or 'Unknown'
            cntry = meta.get('country') or 'Unknown'
            
            price = row.get('last_close_price') or row.get('average_entry_price') or 0
            val = float(row.get('total_shares', 0)) * float(price)
            
            total_val += val
            sector_value[sec] = sector_value.get(sec, 0) + val
            if sec not in sector_assets: sector_assets[sec] = []
            sector_assets[sec].append(sym)
            
            country_value[cntry] = country_value.get(cntry, 0) + val
            if cntry not in country_assets: country_assets[cntry] = []
            country_assets[cntry].append(sym)
                
        sector_breakdown = {}
        country_breakdown = {}
        if total_val > 0:
            for s, v in sector_value.items(): sector_breakdown[s] = round((v / total_val) * 100, 2)
            for c, v in country_value.items(): country_breakdown[c] = round((v / total_val) * 100, 2)
            
        data = yf.download(symbols, period="1y")
        if 'Close' in data:
            data = data['Close']
            
        if isinstance(data, pd.Series): 
            # Only 1 symbol
            return jsonify({"status": "success", "data": {"correlation": {}, "sharpe_ratio": 0}})
            
        # Drop assets that have no valid historical data at all
        returns = data.pct_change().dropna(axis=1, how='all')
        # Convert NaN to 0 for JSON serialization
        corr_matrix = returns.corr().fillna(0).to_dict()
        
        mean_daily_return = returns.mean(axis=1).mean()
        std_daily_return = returns.mean(axis=1).std()
        risk_free_rate = 0.04 / 252 
        
        if pd.isna(std_daily_return) or std_daily_return <= 0:
            sharpe_ratio = 0
        else:
            sharpe_ratio = ((mean_daily_return - risk_free_rate) / std_daily_return) * np.sqrt(252)
            
        if pd.isna(sharpe_ratio) or np.isnan(sharpe_ratio) or np.isinf(sharpe_ratio):
            sharpe_ratio = 0
            
        return jsonify({
            "status": "success", 
            "data": {
                "correlation": corr_matrix,
                "sharpe_ratio": sharpe_ratio,
                "sector_breakdown": sector_breakdown,
                "country_breakdown": country_breakdown,
                "sector_assets": sector_assets,
                "country_assets": country_assets
            }
        })
    except Exception as e:
        print(f"Error fetching portfolio metrics: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/fundamentals/<symbol>', methods=['GET'])
def get_fundamentals(symbol):
    try:
        # Check cache first
        if supabase:
            cache_res = supabase.table('financials_cache').select('*').eq('symbol', symbol).execute()
            if cache_res.data and len(cache_res.data) > 0:
                cache_record = cache_res.data[0]
                last_updated = datetime.datetime.fromisoformat(cache_record['last_updated'].replace('Z', '+00:00'))
                # If cache is less than 24 hours old, return it
                if (datetime.datetime.now(datetime.timezone.utc) - last_updated).total_seconds() < 86400:
                    print(f"Returning fundamentals for {symbol} from cache")
                    return jsonify(cache_record['quarterly_data'])

        print(f"Fetching fresh fundamentals for {symbol}")
        yf_symbol = get_yf_ticker(symbol)
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
        service = PortfolioManagerService(supabase_client=supabase)
        fundamentals = service.get_fundamental_data(symbol)
        quarterly = service.get_quarterly_financials(symbol)
        macro_analysis = service.synthesize_macro_analysis(symbol, fundamentals)
        
        response_data = {
            "status": "success", 
            "data": fundamentals,
            "quarterly": quarterly,
            "macro_analysis": macro_analysis
        }

        # Update cache
        if supabase:
            try:
                supabase.table('financials_cache').upsert({
                    'symbol': symbol,
                    'quarterly_data': response_data,
                    'last_updated': datetime.datetime.now(datetime.timezone.utc).isoformat()
                }).execute()
            except Exception as cache_err:
                print(f"Error caching financials for {symbol}: {cache_err}")

        return jsonify(response_data)
    except Exception as e:
        print(f"Error fetching fundamentals for {symbol}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/macro-data', methods=['GET'])
def get_macro_data():
    try:
        from data_ingestion import DataIngestionService
        svc = DataIngestionService(supabase_client=supabase)
        macro = svc.get_macro_regime()
        
        # Get portfolio tickers to filter economic calendar
        tickers_res = supabase.table('tickers').select('symbol').execute() if supabase else None
        symbols = [t['symbol'] for t in tickers_res.data] if tickers_res and tickers_res.data else []
        
        calendar = svc.get_economic_calendar(symbols)
        macro['economic_calendar'] = calendar
        
        return jsonify({
            "status": "success",
            "data": macro
        })
    except Exception as e:
        print(f"Error fetching macro data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/generate-calendar-insights', methods=['POST'])
def generate_calendar_insights():
    try:
        data = request.json
        events = data.get('events', [])
        if not events:
            return jsonify({"status": "success", "insights": {}})
            
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        
        # Check cache first
        if supabase:
            cache_res = supabase.table('calendar_insights_cache').select('insights').eq('cache_date', today).execute()
            if cache_res.data and len(cache_res.data) > 0:
                print("Returning calendar insights from cache")
                return jsonify({"status": "success", "insights": cache_res.data[0]['insights']})
                
        print("Generating new calendar insights via Gemini")
        prompt = "You are a Bloomberg macro analyst. For each of the following upcoming economic events, provide a strict 1-sentence insight on how it might impact the stock market or specific sectors. Output JSON where the exact keys are the event titles provided below, and values are the 1-sentence insight.\n\nEvents:\n"
        for ev in events:
            prompt += f"- {ev.get('title')}\n"
            
        model = genai.GenerativeModel('gemini-3.8-flash')
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
            )
        )
        insights = json.loads(response.text)
        
        # Save to cache
        if supabase:
            try:
                supabase.table('calendar_insights_cache').insert({
                    "cache_date": today,
                    "insights": insights
                }).execute()
            except Exception as cache_err:
                print(f"Error caching insights: {cache_err}")
                
        return jsonify({"status": "success", "insights": insights})
    except Exception as e:
        print(f"Error generating insights: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/run-discovery', methods=['POST'])
def run_discovery():
    try:
        # Run discovery engine in the background or blocking
        from discovery_engine import DiscoveryEngineService
        engine = DiscoveryEngineService(supabase_client=supabase)
        
        # We can run the pipeline directly
        # To avoid timeout, we might want to do it in a thread, but for this MVP blocking is okay if it's < 30s.
        # Let's run it in a thread to be safe and return "processing"
        def run():
            try:
                engine.run_discovery()
            except Exception as ex:
                print("Discovery Engine Error:", ex)
                
        threading.Thread(target=run).start()
        return jsonify({"status": "success", "message": "Discovery Engine triggered in the background. It will take ~30-60 seconds."})
    except Exception as e:
        print(f"Error running discovery engine: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/social-sentiment/<symbol>', methods=['GET'])
def get_social_sentiment(symbol):
    try:
        from news_aggregator import NewsAggregatorService
        service = NewsAggregatorService(supabase_client=supabase)
        articles = service.fetch_alternative_sentiment(symbol)
        
        # Analyze sentiment
        analyzed_articles = service.analyze_sentiment(symbol, articles)
        
        return jsonify({
            "status": "success",
            "data": analyzed_articles
        })
    except Exception as e:
        print(f"Error fetching social sentiment for {symbol}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/news-summary/<symbol>', methods=['GET'])
def get_news_summary(symbol):
    try:
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500

        # Fetch recent Tier 1/2 news from database
        res = supabase.table('news_events').select('*').eq('symbol', symbol).order('published_at', desc=True).limit(10).execute()
        news = res.data or []
        
        # Filter for tier 1/2
        top_tier_news = [n for n in news if int(n.get('source_tier', 3)) <= 2]
        
        if not top_tier_news:
            return jsonify({"status": "success", "summary": "No recent Tier 1 or Tier 2 institutional news found to summarize."})

        prompt = f"You are a hedge fund analyst. Write a concise, 2-3 sentence executive summary describing the recent institutional news flow for {symbol} and its market impact. Here are the recent headlines:\n\n"
        for n in top_tier_news:
            prompt += f"- {n.get('headline')} (Source: {n.get('source')})\n"

        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        
        return jsonify({
            "status": "success",
            "summary": response.text.strip()
        })
    except Exception as e:
        print(f"Error generating news summary for {symbol}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
