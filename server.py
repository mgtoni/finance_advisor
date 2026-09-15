import os
import warnings
# Suppress package deprecation warnings (e.g., google.generativeai and duckduckgo_search)
warnings.filterwarnings("ignore")
from flask import Flask, jsonify, request, make_response
import yfinance as yf
from main import main as run_pipeline

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
        
        ticker = yf.Ticker(symbol)
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
    # Run on port 5000 with adhoc SSL context to bypass HTTPS mixed content restrictions
    app.run(host='127.0.0.1', port=5000, ssl_context='adhoc')
