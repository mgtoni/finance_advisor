import os
from flask import Flask, jsonify
from flask_cors import CORS
from main import main as run_pipeline

app = Flask(__name__)
# Allow CORS for the dashboard frontend (running on Vite's default port or Vercel)
CORS(app, resources={r"/api/*": {"origins": "*"}})

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

if __name__ == '__main__':
    # Run on port 5000
    app.run(host='0.0.0.0', port=5000)
