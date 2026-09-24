import os
import sys
import json
import unittest
from unittest.mock import patch
from dotenv import load_dotenv

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

load_dotenv()

from server import app, load_discovery_status, save_discovery_status, load_watchlist_cache, save_watchlist_cache

class TestServerEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_01_discovery_status(self):
        """Test GET /api/discovery-status"""
        res = self.client.get('/api/discovery-status')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get('status'), 'success')
        self.assertIn('data', data)
        self.assertIn('is_running', data['data'])
        self.assertIn('stage', data['data'])
        print("[PASS] GET /api/discovery-status passed")

    def test_02_discovery_picks_retrieval(self):
        """Test GET /api/discovery-picks with strategy filters"""
        res = self.client.get('/api/discovery-picks')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get('status'), 'success')
        self.assertIsInstance(data.get('data'), list)
        print(f"[PASS] GET /api/discovery-picks passed: {len(data['data'])} picks returned")

        # Test with strategy query
        res_strat = self.client.get('/api/discovery-picks?strategy=value')
        self.assertEqual(res_strat.status_code, 200)
        data_strat = res_strat.get_json()
        self.assertEqual(data_strat.get('status'), 'success')
        print(f"[PASS] GET /api/discovery-picks?strategy=value passed: {len(data_strat['data'])} picks returned")

    def test_03_watchlist_crud_lifecycle(self):
        """Test full Watchlist lifecycle: POST -> GET -> DELETE"""
        test_stock = {
            'symbol': 'AZN.L',
            'company_name': 'AstraZeneca PLC',
            'sector': 'Healthcare',
            'country': 'United Kingdom',
            'price': 124.50,
            'added_from': 'non_us',
            'notes': 'Quality UK healthcare champion'
        }

        # 1. Add to Watchlist
        post_res = self.client.post('/api/watchlist', json=test_stock)
        self.assertEqual(post_res.status_code, 200)
        post_data = post_res.get_json()
        self.assertEqual(post_data.get('status'), 'success')
        self.assertEqual(post_data['data']['symbol'], 'AZN.L')
        print("[PASS] POST /api/watchlist passed:", post_data['data']['symbol'])

        # 2. Retrieve Watchlist
        get_res = self.client.get('/api/watchlist')
        self.assertEqual(get_res.status_code, 200)
        get_data = get_res.get_json()
        self.assertEqual(get_data.get('status'), 'success')
        symbols = [item['symbol'] for item in get_data['data']]
        self.assertIn('AZN.L', symbols)
        print(f"[PASS] GET /api/watchlist passed: found {len(symbols)} items including AZN.L")

        # 3. Remove from Watchlist
        del_res = self.client.delete('/api/watchlist/AZN.L')
        self.assertEqual(del_res.status_code, 200)
        del_data = del_res.get_json()
        self.assertEqual(del_data.get('status'), 'success')
        print("[PASS] DELETE /api/watchlist/AZN.L passed")

        # 4. Verify removal
        get_res_after = self.client.get('/api/watchlist')
        symbols_after = [item['symbol'] for item in get_res_after.get_json()['data']]
        self.assertNotIn('AZN.L', symbols_after)
        print("[PASS] Watchlist deletion verified")

    @patch('discovery_engine.DiscoveryEngineService.run_discovery_pipeline')
    def test_04_run_discovery_endpoint(self, mock_run_discovery):
        """Test POST /api/run-discovery validation, triggers, and 409 busy state"""
        import time
        def mock_delayed_run(*args, **kwargs):
            time.sleep(0.4)
            return []
        mock_run_discovery.side_effect = mock_delayed_run

        payload = {
            'strategy': 'income',
            'market_cap_tier': 'all',
            'region_preference': 'all',
            'listing_type': 'hybrid',
            'strict_health_filter': True
        }


        # Ensure starting in idle state
        save_discovery_status({
            'is_running': False,
            'strategy': None,
            'started_at': None,
            'finished_at': None,
            'stage': 'Idle'
        })

        res = self.client.post('/api/run-discovery', json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get('status'), 'success')
        self.assertTrue(data.get('discovery_status', {}).get('is_running'))
        print("[PASS] POST /api/run-discovery triggered successfully")

        # Test busy state handling (second call while running returns 409)
        res_busy = self.client.post('/api/run-discovery', json=payload)
        self.assertEqual(res_busy.status_code, 409)
        self.assertEqual(res_busy.get_json().get('status'), 'busy')
        print("[PASS] POST /api/run-discovery concurrency guard (409) verified")

        # Reset status back to idle
        save_discovery_status({
            'is_running': False,
            'strategy': None,
            'started_at': None,
            'finished_at': None,
            'stage': 'Idle'
        })

if __name__ == '__main__':
    print("=== RUNNING FLASK SERVER VPS VERIFICATION TEST SUITE ===")
    unittest.main(verbosity=2)
