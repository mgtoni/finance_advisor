import os
from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
from main import main as run_pipeline

app = Flask(__name__)
# allow_private_network=True is required to fix the Chrome loopback restriction
CORS(app, resources={r"/api/*": {"origins": "*"}}, allow_private_network=True)

@app.route('/api/run-analysis', methods=['POST', 'OPTIONS'])
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
    # Run on port 5000
    app.run(host='127.0.0.1', port=5002)
