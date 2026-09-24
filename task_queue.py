"""
Distributed Background Task Queue & Status Service.
Optimized for: Supabase + IONOS VPS + Vercel Deployment Architecture.

Features:
1. Supabase-Backed Distributed Task Tracking:
   - Primary state stored in Supabase `background_tasks` table.
   - Dual-mode automatic fallback to local disk cache (`discovery_status.json`) if table is not yet created.
2. Self-Healing Concurrency Lock:
   - Prevents duplicate pipeline collisions across multi-worker WSGI processes (Gunicorn on IONOS VPS).
   - Automatically reclaims stale locks if an active task has no heartbeat for > 15 minutes (recovering from worker SIGKILL).
3. Real-Time Stage & Progress Tracking:
   - Live stage-by-stage progress updates for Vercel SPA polling.
4. Thread & Memory Safety:
   - Encapsulated execution with complete try/except/finally lifecycle management.
"""

import os
import sys
import json
import time
import uuid
import threading
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

# Ensure project root in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import sanitize_value

STATUS_FILE = os.path.join(os.path.dirname(__file__), 'discovery_status.json')
STALE_HEARTBEAT_SECONDS = 900  # 15 minutes


class BackgroundTaskQueue:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        self._supabase_table_available = None  # None = untested, True = works, False = fallback

    def _now_iso(self):
        return datetime.now(timezone.utc).isoformat()

    def _save_local_status(self, payload):
        """Fallback to local disk state."""
        try:
            with open(STATUS_FILE, 'w', encoding='utf-8') as f:
                json.dump(sanitize_value(payload), f, indent=2)
        except Exception as e:
            print(f"Notice writing local status file: {e}")

    def _load_local_status(self):
        """Read fallback local disk state."""
        if os.path.exists(STATUS_FILE):
            try:
                with open(STATUS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            'is_running': False,
            'status': 'idle',
            'stage': 'Idle',
            'progress': 0,
            'started_at': None,
            'finished_at': None
        }

    def _check_supabase_table(self):
        """Verifies if the background_tasks table is accessible in Supabase."""
        if not self.supabase:
            return False
        if self._supabase_table_available is not None:
            return self._supabase_table_available
        try:
            res = self.supabase.table('background_tasks').select('id').limit(1).execute()
            self._supabase_table_available = True
            return True
        except Exception:
            self._supabase_table_available = False
            return False

    def is_task_running(self, task_type='discovery'):
        """
        Checks if an active task of this type is currently executing.
        Implements self-healing stale lock reclamation.
        """
        # 1. Check Supabase state
        if self._check_supabase_table():
            try:
                res = self.supabase.table('background_tasks') \
                    .select('*') \
                    .eq('task_type', task_type) \
                    .eq('status', 'running') \
                    .order('created_at', desc=True) \
                    .limit(1) \
                    .execute()

                if res.data and len(res.data) > 0:
                    active_task = res.data[0]
                    # Check for stale heartbeat
                    heartbeat_str = active_task.get('heartbeat_at') or active_task.get('created_at')
                    if heartbeat_str:
                        try:
                            hb_dt = datetime.fromisoformat(heartbeat_str.replace('Z', '+00:00'))
                            age = (datetime.now(timezone.utc) - hb_dt).total_seconds()
                            if age > STALE_HEARTBEAT_SECONDS:
                                print(f"[TASK QUEUE] Reclaiming stale lock for task {active_task['id']} (Age: {age:.0f}s)")
                                self.supabase.table('background_tasks').update({
                                    'status': 'failed',
                                    'stage': 'Terminated (Stale Timeout / Worker Recycled)',
                                    'error_message': f'No heartbeat received for {age:.0f} seconds.',
                                    'finished_at': self._now_iso()
                                }).eq('id', active_task['id']).execute()
                                return False
                        except Exception:
                            pass
                    return True
            except Exception as e:
                print(f"Notice checking Supabase task status: {e}")

        # 2. Local fallback check
        local = self._load_local_status()
        if local.get('is_running'):
            started_str = local.get('started_at')
            if started_str:
                try:
                    s_dt = datetime.fromisoformat(started_str.replace('Z', '+00:00'))
                    age = (datetime.now(timezone.utc) - s_dt).total_seconds()
                    if age > STALE_HEARTBEAT_SECONDS:
                        print(f"[TASK QUEUE] Reclaiming stale local lock (Age: {age:.0f}s)")
                        local['is_running'] = False
                        local['status'] = 'failed'
                        local['stage'] = 'Terminated (Stale Timeout)'
                        self._save_local_status(local)
                        return False
                except Exception:
                    pass
            return True
        return False

    def get_latest_task_status(self, task_type='discovery'):
        """Returns the status and progress of the latest task."""
        if self._check_supabase_table():
            try:
                res = self.supabase.table('background_tasks') \
                    .select('*') \
                    .eq('task_type', task_type) \
                    .order('created_at', desc=True) \
                    .limit(1) \
                    .execute()
                if res.data and len(res.data) > 0:
                    row = res.data[0]
                    is_run = row.get('status') == 'running'
                    return {
                        'task_id': row.get('id'),
                        'is_running': is_run,
                        'status': row.get('status', 'idle'),
                        'stage': row.get('stage', 'Idle'),
                        'progress': row.get('progress', 0),
                        'stage_index': row.get('stage_index', 1),
                        'total_stages': row.get('total_stages', 4),
                        'market': row.get('market'),
                        'strategy': row.get('strategy'),
                        'started_at': row.get('started_at'),
                        'finished_at': row.get('finished_at'),
                        'heartbeat_at': row.get('heartbeat_at'),
                        'error_message': row.get('error_message')
                    }
            except Exception as e:
                print(f"Notice fetching task status from Supabase: {e}")

        # Local fallback
        local = self._load_local_status()
        return {
            'task_id': local.get('task_id', 'local-task'),
            'is_running': local.get('is_running', False),
            'status': local.get('status', 'idle'),
            'stage': local.get('stage', 'Idle'),
            'progress': local.get('progress', 0),
            'stage_index': local.get('stage_index', 1),
            'total_stages': local.get('total_stages', 4),
            'market': local.get('market'),
            'strategy': local.get('strategy'),
            'started_at': local.get('started_at'),
            'finished_at': local.get('finished_at'),
            'error_message': local.get('error_message')
        }

    def update_task_progress(self, task_id, stage, stage_index, total_stages=4, progress_pct=None):
        """Updates real-time stage progress and refreshes heartbeat."""
        now_str = self._now_iso()
        if progress_pct is None:
            progress_pct = int((stage_index / max(total_stages, 1)) * 100)

        update_fields = {
            'stage': stage,
            'stage_index': stage_index,
            'total_stages': total_stages,
            'progress': progress_pct,
            'heartbeat_at': now_str
        }

        # 1. Update Supabase
        if self._check_supabase_table() and task_id:
            try:
                self.supabase.table('background_tasks').update(update_fields).eq('id', task_id).execute()
            except Exception as e:
                print(f"Notice updating task progress in Supabase: {e}")

        # 2. Update local disk fallback
        local = self._load_local_status()
        local.update(update_fields)
        self._save_local_status(local)

    def enqueue_discovery_task(self, market='usa', strategy='value', target_contenders=20, params=None, run_synchronous=False):
        """
        Enqueues and executes a Discovery Funnel run.
        If run_synchronous is True, blocks until completion on the current thread.
        Otherwise, spawns a background worker thread.
        Returns: (success: bool, task_id: str, message: str)
        """
        if self.is_task_running(task_type='discovery'):
            return False, None, "A discovery funnel run is already in progress. Please wait for completion."

        task_id = str(uuid.uuid4())
        now_str = self._now_iso()

        initial_task_data = {
            'id': task_id,
            'task_type': 'discovery',
            'status': 'running',
            'market': market,
            'strategy': strategy,
            'stage': f"Stage 1: Ingesting {market.upper()} universe & pre-flight gate...",
            'progress': 10,
            'stage_index': 1,
            'total_stages': 4,
            'params': sanitize_value(params or {}),
            'started_at': now_str,
            'heartbeat_at': now_str
        }

        # 1. Record in Supabase
        if self._check_supabase_table():
            try:
                self.supabase.table('background_tasks').insert(initial_task_data).execute()
            except Exception as e:
                print(f"Notice creating task in Supabase: {e}")

        # 2. Record local fallback
        local_payload = dict(initial_task_data)
        local_payload['is_running'] = True
        self._save_local_status(local_payload)

        # 3. Worker routine
        def worker_routine():
            print(f"\n[BACKGROUND WORKER] Started Discovery Pipeline Task: {task_id} ({market.upper()} / {strategy})")
            t_start = time.time()
            try:
                from discovery_engine import DiscoveryEngineService
                engine = DiscoveryEngineService(supabase_client=self.supabase)

                # Progress callback hook into task queue
                def on_stage_progress(is_run, stage_name, s_idx, t_stages, strat, mkt):
                    self.update_task_progress(task_id, stage_name, s_idx, t_stages)

                engine._update_status = on_stage_progress

                # Run the complete 4-stage funnel
                final_picks = engine.run_discovery_pipeline(
                    market=market,
                    strategy=strategy,
                    target_contenders=target_contenders
                )

                elapsed = round(time.time() - t_start, 2)
                completion_data = {
                    'status': 'completed',
                    'stage': 'Complete',
                    'progress': 100,
                    'finished_at': self._now_iso(),
                    'result_summary': {
                        'elapsed_seconds': elapsed,
                        'winners_count': len(final_picks),
                        'winner_symbols': [p.get('symbol') for p in final_picks]
                    }
                }

                # Save completed state
                if self._check_supabase_table():
                    try:
                        self.supabase.table('background_tasks').update(completion_data).eq('id', task_id).execute()
                    except Exception as ce:
                        print(f"Notice saving task completion to Supabase: {ce}")

                local = self._load_local_status()
                local.update(completion_data)
                local['is_running'] = False
                self._save_local_status(local)
                print(f"[BACKGROUND WORKER] Task {task_id} completed successfully in {elapsed}s.")

            except Exception as ex:
                elapsed = round(time.time() - t_start, 2)
                print(f"[BACKGROUND WORKER ERROR] Task {task_id} failed after {elapsed}s: {ex}")
                error_data = {
                    'status': 'failed',
                    'stage': f"Error: {str(ex)}",
                    'error_message': str(ex),
                    'finished_at': self._now_iso()
                }

                if self._check_supabase_table():
                    try:
                        self.supabase.table('background_tasks').update(error_data).eq('id', task_id).execute()
                    except Exception:
                        pass

                local = self._load_local_status()
                local.update(error_data)
                local['is_running'] = False
                self._save_local_status(local)

        if run_synchronous:
            worker_routine()
        else:
            thread = threading.Thread(target=worker_routine, name=f"DiscoveryWorker-{task_id[:8]}", daemon=True)
            thread.start()

        return True, task_id, f"4-Stage Discovery Funnel {'executed' if run_synchronous else 'enqueued'} successfully (Task ID: {task_id})."
