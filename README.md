# Quantitative Financial Advisor Pipeline

A fully automated, daily research analyst and portfolio management pipeline running on a strict budget. Uses open-source libraries, free APIs, and Supabase.

## Microservices Architecture

1.  **Microservice 1: Data Ingestion (`data_ingestion.py`)**
    *   Fetches daily close prices via `yfinance`.
    *   Fetches Macro Regime (VIX and 10Y Yield).
    *   Estimates Earnings Drift.
    *   Scans SEC Form 4s for insider cluster buying via `edgartools`.

2.  **Microservice 2: News Aggregator (`news_aggregator.py`)**
    *   Parallel scraping using Yahoo Finance, DuckDuckGo News, and Google News RSS.
    *   Fuzzy deduplication by headline and URL.

3.  **Microservice 3: Quantitative Engine (`quant_engine.py`)**
    *   Uses `pandas-ta` to calculate a composite score (-1.0 to 1.0).
    *   Detects market regime (ADX/DMI), volatility squeezes (TTM Squeeze), and smart money divergence (OBV/PVT) across Daily and Weekly timeframes.

4.  **Microservice 4: LLM Synthesis & Portfolio Manager (`portfolio_manager.py`)**
    *   Aggregates outputs from the first three microservices.
    *   Queries Supabase for current portfolio context (unrealized PnL, open date).
    *   Uses Gemini 1.5 Pro to synthesize the data into a strict JSON decision (BUY_MORE, HOLD, SELL) with conviction scores.
    *   Logs decisions to Supabase and sends notifications to a Discord Webhook.

## Setup Instructions

1.  **Environment Variables**:
    Create a `.env` file in the root directory:
    ```env
    SUPABASE_URL=your_supabase_project_url
    SUPABASE_KEY=your_supabase_api_key
    GEMINI_API_KEY=your_gemini_api_key
    DISCORD_WEBHOOK_URL=your_discord_webhook_url
    EDGAR_IDENTITY="Your Name (your_email@example.com)"
    ```

2.  **Database**:
    *   Run the SQL provided in `schema.sql` inside your Supabase SQL Editor to initialize the tables (`tickers`, `news_events`, `prediction_logs`).
    *   Ensure the `tickers` table is seeded with your starting portfolio.

3.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run Locally**:
    ```bash
    python main.py
    ```

## GitHub Actions Deployment (Free Scheduling)

To run this automatically every day after market close (e.g., 5 PM EST / 9 PM UTC), you can create a GitHub Actions workflow:

1. Create a file `.github/workflows/daily_pipeline.yml`.
2. Use the following configuration:

```yaml
name: Daily Quant Pipeline

on:
  schedule:
    - cron: '0 21 * * 1-5' # Runs at 21:00 UTC Monday-Friday

jobs:
  run-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run Pipeline
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          EDGAR_IDENTITY: ${{ secrets.EDGAR_IDENTITY }}
        run: python main.py
```
## Vercel Deployment (Web Dashboard)

The frontend application (`/dashboard`) is a Vite React SPA and is pre-configured for Vercel deployment.

**Vercel Project Settings:**
1. Import your GitHub repository into Vercel.
2. **Root Directory**: Set this to `dashboard` (Important: Vercel needs to know the app isn't in the root of the repo).
3. **Framework Preset**: Vercel should auto-detect **Vite**.
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist`
6. **Install Command**: `npm install`

**Environment Variables (Add these in the Vercel Settings -> Environment Variables):**
*   `VITE_SUPABASE_URL`: Your Supabase Project URL (e.g., `https://tlqucihtxossompdcsfv.supabase.co`)
*   `VITE_SUPABASE_ANON_KEY`: Your Supabase Publishable Key (e.g., `sb_publishable_...`)

Once deployed, the dashboard will be live and protected by your Supabase Authentication!
