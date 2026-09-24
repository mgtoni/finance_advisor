"""
Autonomous Zero-Supervision Scheduler Daemon for IONOS VPS / Docker.
Uses APScheduler with UTC timezone to run institutional quantitative pipelines:
1. Scheduled News Aggregation (Intraday market updates)
2. Daily AI Portfolio Manager Synthesis (Post-market close)
3. 4-Stage Discovery Engine Funnel:
   - USA Universe (Mon-Fri 21:30 UTC)
   - UK & European Universe (Mon 17:30 UTC)
   - Asia / Japan Universe (Sun 23:00 UTC)

Zero Supervision Features:
- Survives VPS reboots & container restarts
- Coalesces missed executions during temporary downtime
- Self-healing task locks via task_queue.py
- Graceful SIGTERM/SIGINT shutdown
"""

import sys
import os
import signal
import time
import pytz
from datetime import datetime
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from main import get_supabase_client
from task_queue import BackgroundTaskQueue


def get_queue():
    supabase = get_supabase_client()
    return BackgroundTaskQueue(supabase_client=supabase), supabase


import requests

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:5000")


def trigger_discovery_job(market='usa', strategy='value'):
    print(f"\n[{datetime.now(pytz.utc).isoformat()}] [SCHEDULER] Triggering {market.upper()} Discovery Funnel ({strategy.upper()})...")
    # 1. Try hitting the API endpoint first (so all disk caches and status live in the primary container)
    for base in [BACKEND_URL, "http://localhost:5000", "http://127.0.0.1:5000"]:
        try:
            url = f"{base}/api/cron/discovery?market={market}&strategy={strategy}"
            resp = requests.post(url, timeout=10)
            if resp.status_code in [200, 409]:
                print(f"[SCHEDULER API SUCCESS] Triggered via {base}: {resp.status_code} - {resp.text}")
                return
        except Exception:
            continue

    # 2. Fallback: Run directly via Python Task Queue
    print("[SCHEDULER NOTICE] Backend HTTP endpoint unreachable. Executing directly in scheduler process...")
    try:
        queue, _ = get_queue()
        success, task_id, msg = queue.enqueue_discovery_task(
            market=market,
            strategy=strategy,
            target_contenders=20,
            run_synchronous=True
        )
        print(f"[SCHEDULER SUCCESS] {market.upper()} Discovery {task_id}: {msg}")
    except Exception as e:
        print(f"[SCHEDULER ERROR] Failed to run {market.upper()} Discovery: {e}")


def job_discovery_usa():
    trigger_discovery_job(market='usa', strategy='value')


def job_discovery_uk_europe():
    trigger_discovery_job(market='uk', strategy='value')


def job_discovery_japan():
    trigger_discovery_job(market='japan', strategy='value')


def job_news_aggregation():
    print(f"\n[{datetime.now(pytz.utc).isoformat()}] [SCHEDULER] Triggering Intraday News Aggregation...")
    try:
        _, supabase = get_queue()
        if not supabase:
            print("[SCHEDULER WARN] Supabase not connected. Skipping news run.")
            return
        from news_aggregator import NewsAggregatorService
        res = supabase.table('positions').select('symbol').execute()
        tickers = list(set([r['symbol'] for r in res.data])) if res.data else ['AAPL', 'MSFT']
        service = NewsAggregatorService(supabase_client=supabase)
        service.run_aggregation(tickers)
        print(f"[SCHEDULER SUCCESS] News aggregation completed for {len(tickers)} assets.")
    except Exception as e:
        print(f"[SCHEDULER ERROR] Failed in news aggregation: {e}")


def job_portfolio_synthesis():
    print(f"\n[{datetime.now(pytz.utc).isoformat()}] [SCHEDULER] Triggering AI Portfolio Analysis Synthesis...")
    try:
        _, supabase = get_queue()
        if not supabase:
            print("[SCHEDULER WARN] Supabase not connected. Skipping portfolio synthesis.")
            return
        from portfolio_manager import PortfolioManagerService
        pm = PortfolioManagerService(supabase_client=supabase)
        analysis = pm.synthesize_portfolio()
        print(f"[SCHEDULER SUCCESS] Portfolio synthesis completed: Action={analysis.get('action') if isinstance(analysis, dict) else 'OK'}")
    except Exception as e:
        print(f"[SCHEDULER ERROR] Failed in portfolio synthesis: {e}")


def main():
    # Allow running one job immediately for test/validation
    if len(sys.argv) > 1 and sys.argv[1] == "--run-now":
        target = sys.argv[2] if len(sys.argv) > 2 else "discovery_usa"
        print(f"[SCHEDULER TEST] Running target immediately: {target}")
        if target == "discovery_usa": job_discovery_usa()
        elif target == "discovery_uk": job_discovery_uk_europe()
        elif target == "discovery_japan": job_discovery_japan()
        elif target == "news": job_news_aggregation()
        elif target == "portfolio": job_portfolio_synthesis()
        else:
            print(f"Unknown target: {target}")
        sys.exit(0)

    scheduler = BlockingScheduler(timezone=pytz.utc)

    # 1. Mon-Fri at 13:30 UTC (9:30 AM EST US Open): Intraday News
    scheduler.add_job(
        job_news_aggregation,
        trigger=CronTrigger(day_of_week='mon-fri', hour=13, minute=30, timezone=pytz.utc),
        id='job_news_morning',
        name='Morning News Aggregation',
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600
    )

    # 2. Mon-Fri at 21:00 UTC (5:00 PM EST US Close): AI Portfolio Synthesis
    scheduler.add_job(
        job_portfolio_synthesis,
        trigger=CronTrigger(day_of_week='mon-fri', hour=21, minute=0, timezone=pytz.utc),
        id='job_portfolio_close',
        name='Post-Market Portfolio Synthesis',
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600
    )

    # 3. Mon-Fri at 21:30 UTC: 4-Stage Discovery Funnel (USA Universe)
    scheduler.add_job(
        job_discovery_usa,
        trigger=CronTrigger(day_of_week='mon-fri', hour=21, minute=30, timezone=pytz.utc),
        id='job_discovery_usa',
        name='USA Discovery Funnel',
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600
    )

    # 4. Monday at 17:30 UTC (European Close): UK/Europe Discovery Funnel
    scheduler.add_job(
        job_discovery_uk_europe,
        trigger=CronTrigger(day_of_week='mon', hour=17, minute=30, timezone=pytz.utc),
        id='job_discovery_europe',
        name='UK & Europe Discovery Funnel',
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600
    )

    # 5. Sunday at 23:00 UTC (Tokyo Open): Japan / Asia Discovery Funnel
    scheduler.add_job(
        job_discovery_japan,
        trigger=CronTrigger(day_of_week='sun', hour=23, minute=0, timezone=pytz.utc),
        id='job_discovery_japan',
        name='Japan Discovery Funnel',
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600
    )

    print("===================================================================")
    print(" [IONOS VPS AUTONOMOUS SCHEDULER DAEMON STARTED - 0 SUPERVISION]")
    print(" Active Jobs:")
    for job in scheduler.get_jobs():
        print(f"  * {job.name} ({job.id}) -> Next run at: {job.next_run_time}")
    print("===================================================================\n")

    def shutdown(signum, frame):
        print(f"\n[SCHEDULER] Signal {signum} received. Shutting down gracefully...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == '__main__':
    main()
