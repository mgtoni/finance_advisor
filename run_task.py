"""
Headless CLI & Cron Runner for IONOS VPS.
Allows running background tasks (Discovery Funnel, News Aggregation, Portfolio Analysis)
directly via CLI or Linux system crontab without HTTP web-server timeouts.

Usage examples:
  python run_task.py --task discovery --market usa --strategy value
  python run_task.py --task discovery --market uk --strategy value
  python run_task.py --task discovery --market europe --strategy value
  python run_task.py --task news
  python run_task.py --task portfolio
"""

import sys
import argparse
import os
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

load_dotenv()

# Ensure project root in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import get_supabase_client
from task_queue import BackgroundTaskQueue


def main():
    parser = argparse.ArgumentParser(description="IONOS VPS Headless Task Runner")
    parser.add_argument("--task", type=str, default="discovery", choices=["discovery", "news", "portfolio"],
                        help="Task type to execute")
    parser.add_argument("--market", type=str, default="usa", choices=["usa", "uk", "europe", "japan", "global"],
                        help="Target market universe for discovery")
    parser.add_argument("--strategy", type=str, default="value",
                        choices=["value", "income", "reduce_risk", "growth", "non_us"],
                        help="Investment strategy profile")
    parser.add_argument("--target-contenders", type=int, default=20,
                        help="Number of contenders to isolate in Stage 2")

    args = parser.parse_args()

    supabase = get_supabase_client()
    task_queue = BackgroundTaskQueue(supabase_client=supabase)

    print(f"\n=======================================================")
    print(f"[IONOS VPS TASK RUNNER] Launching Task: {args.task.upper()}")
    print(f"Market: {args.market.upper()} | Strategy: {args.strategy.upper()}")
    print(f"=======================================================\n")

    if args.task == "discovery":
        print("[RUNNER] Executing 4-Stage Discovery Pipeline via Task Queue...")
        success, task_id, msg = task_queue.enqueue_discovery_task(
            market=args.market,
            strategy=args.strategy,
            target_contenders=args.target_contenders,
            run_synchronous=True
        )
        if not success:
            print(f"[RUNNER BUSY/SKIPPED] {msg}")
            sys.exit(0)
        print(f"\n[RUNNER SUCCESS] Discovery Pipeline Task {task_id} finished.")

    elif args.task == "news":
        from news_aggregator import NewsAggregatorService
        if not supabase:
            print("Supabase client required for news aggregation.")
            return
        res = supabase.table('positions').select('symbol').execute()
        tickers = list(set([r['symbol'] for r in res.data])) if res.data else ['AAPL', 'MSFT']
        news_svc = NewsAggregatorService(supabase_client=supabase)
        news_svc.run_aggregation(tickers)
        print("\n[RUNNER SUCCESS] News aggregation complete.")

    elif args.task == "portfolio":
        from portfolio_manager import PortfolioManagerService
        pm = PortfolioManagerService(supabase_client=supabase)
        analysis = pm.synthesize_portfolio()
        print("\n[RUNNER SUCCESS] Portfolio analysis complete:", analysis.get('action'))


if __name__ == "__main__":
    main()
