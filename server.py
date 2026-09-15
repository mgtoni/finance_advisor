import os
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

load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key) if supabase_url else None

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
def trigger_analysis():
    try:
        print("Triggering analysis from API...")
        # Note: running this synchronously may take a minute or two. 
        # In a production VPS setting with long tasks, you'd use Celery/Redis or a background thread.
        # For this MVP dashboard integration, a synchronous run is fine.
        run_pipeline()
        return jsonify({"status": "success", "message": "Analysis completed successfully."}), 200
    except Exception as e:
        print(f"Error running pipeline: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/add-position', methods=['POST'])
def add_position():
    try:
        data = request.json
        symbol = data.get('symbol', '').upper().strip()
        open_date = data.get('open_date')
        shares = float(data.get('shares', 0))
        entry_price = float(data.get('entry_price', 0))

        if not all([symbol, open_date, shares, entry_price]):
            return jsonify({"status": "error", "message": "Missing required fields"}), 400

        # Check currency and get historical FX if needed
        yf_symbol = get_yf_ticker(symbol)
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
        currency = info.get('currency', 'USD')
        
        converted_entry_price = entry_price

        if currency != 'USD':
            fx_ticker = f"{currency}USD=X"
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
                    converted_entry_price = entry_price * float(fx_rate)
                    print(f"Converted {entry_price} {currency} to {converted_entry_price} USD using FX rate {fx_rate}")
                else:
                    print(f"Warning: Could not find historical FX rate for {fx_ticker} around {start_date}. Using 1:1.")
            except Exception as fx_err:
                print(f"Error fetching historical FX for {fx_ticker}: {fx_err}")

        # Insert into Supabase
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase client not initialized"}), 500

        # Upsert ticker
        supabase.table('tickers').upsert({'symbol': symbol}).execute()
        
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
            "currency": currency,
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

        data = []
        for date, row in hist.iterrows():
            data.append({
                "time": int(date.timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"])
            })
            
        return jsonify(data)
    except Exception as e:
        print(f"Error fetching history for {symbol}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    # Run on port 5000
    app.run(host='127.0.0.1', port=5000)
# Trigger Action
