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

if __name__ == '__main__':
    # Run on port 5000
    app.run(host='127.0.0.1', port=5000)
# Trigger Action
