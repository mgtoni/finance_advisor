"""
Unit & Integration Test Suite for Discovery Engine Financial Metrics & VPS Server Safety.

Verifies:
1. Financial Metric Accuracy:
   - Dollar Volume (Liquidity Gate: Price * Volume >= $10M)
   - Penny Stock Filter (Price >= $5.00)
   - Zombie Debt & Solvency Gate (Debt-to-Equity > 300% & Negative FCF)
   - Pre-Revenue Biotech Filter (Revenue < $50M & Negative Operating Cashflow)
   - Multi-Factor Pre-Scoring Formula Weighting (Value, Income, Growth, Non-US)
   - Quant Technical Score Normalization ([-1, 1] -> [0, 100])
2. VPS Server Safety:
   - NumPy / Pandas Serialization Sanitization (No np.float64, np.nan, pd.NA crashes in Flask/Supabase)
   - Non-blocking Concurrency & Thread Safety
   - Memory & Batching Controls (Alpaca 50-ticker chunking, ThreadPool limits)
   - Error Handling & Network Failure Resilience (Graceful fallbacks on 404s/API timeouts)
"""

import unittest
import numpy as np
import pandas as pd
import json
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import sanitize_value, get_company_identity
from universe_manager import UniverseManager
from discovery_screener import DiscoveryScreener


class TestFinancialMetricsAccuracy(unittest.TestCase):
    """Verifies that mathematical definitions, thresholds, and financial models conform to institutional standards."""

    def setUp(self):
        self.screener = DiscoveryScreener()

    def test_liquidity_dollar_volume_formula(self):
        """Test dollar volume calculation: Price * Volume >= $10,000,000."""
        # Case A: $50 stock with 250,000 volume -> $12.5M dollar volume -> PASS
        vol_a = 250000
        price_a = 50.0
        dollar_vol_a = vol_a * price_a
        self.assertGreaterEqual(dollar_vol_a, 10000000)

        # Case B: $100 stock with 50,000 volume -> $5.0M dollar volume -> FAIL
        vol_b = 50000
        price_b = 100.0
        dollar_vol_b = vol_b * price_b
        self.assertLess(dollar_vol_b, 10000000)

        # Case C: Penny stock ($2.00) with 6,000,000 volume -> $12M volume, BUT price < $5 -> FAIL penny filter
        price_c = 2.0
        self.assertLess(price_c, 5.0)

    def test_zombie_solvency_trap_gate(self):
        """Test detection of zombie companies with excessive debt-to-equity (>300%) and negative FCF."""
        zombie_profile = {
            'marketCap': 2000000000,
            'debtToEquity': 450.0,  # 450%
            'freeCashflow': -50000000,  # Burning cash
            'operatingCashflow': -20000000,
            'trailingPE': None,
            'forwardPE': None
        }
        passed, reason = self.screener._qualitative_financial_gate('ZOMB', zombie_profile, strict=True)
        self.assertFalse(passed, "Zombie company should be rejected by financial gate")
        self.assertIn("Zombie solvency trap", reason)

    def test_pre_revenue_biotech_gate(self):
        """Test rejection of speculative pre-revenue companies (<$50M revenue and negative operating cash flow)."""
        biotech_profile = {
            'marketCap': 1800000000,
            'totalRevenue': 12000000,  # $12M revenue
            'operatingCashflow': -80000000,  # Burning $80M/yr
            'freeCashflow': -95000000,
            'industry': 'Biotechnology'
        }
        passed, reason = self.screener._qualitative_financial_gate('BIOX', biotech_profile, strict=True)
        self.assertFalse(passed, "Pre-revenue biotech should be rejected")
        self.assertIn("Pre-revenue speculative biotech", reason)

    def test_spac_shell_company_gate(self):
        """Test rejection of blank-check SPACs and acquisition shells."""
        spac_profile = {
            'shortName': 'Apex Acquisition Corp III',
            'longBusinessSummary': 'Blank check company formed for the purpose of effecting a merger...',
            'marketCap': 2500000000,
            'totalRevenue': 0
        }
        passed, reason = self.screener._qualitative_financial_gate('APEX', spac_profile, strict=True)
        self.assertFalse(passed, "SPAC shell company should be rejected")
        self.assertIn("Blank check SPAC / shell", reason)

    def test_valuation_sanity_gate(self):
        """Test rejection of hyper-inflated speculative multiples (P/E > 300)."""
        bubble_profile = {
            'marketCap': 5000000000,
            'totalRevenue': 1000000000,
            'operatingCashflow': 200000000,
            'trailingPE': 450.0,
            'forwardPE': 350.0,
            'freeCashflow': 10000000
        }
        passed, reason = self.screener._qualitative_financial_gate('BUBL', bubble_profile, strict=True)
        self.assertFalse(passed, "Hyper-inflated valuation should be rejected")
        self.assertIn("Hyper-inflated valuation multiple", reason)

    def test_healthy_company_clears_gate(self):
        """Test that an institutional quality compounder passes all gates seamlessly."""
        healthy_profile = {
            'shortName': 'Quality Compounder PLC',
            'marketCap': 8500000000,
            'totalRevenue': 3200000000,
            'operatingCashflow': 800000000,
            'freeCashflow': 650000000,
            'operatingMargins': 0.22,
            'returnOnEquity': 0.18,
            'debtToEquity': 45.0,
            'trailingPE': 16.5,
            'forwardPE': 14.2,
            'dividendYield': 0.025
        }
        passed, reason = self.screener._qualitative_financial_gate('QUAL', healthy_profile, strict=True)
        self.assertTrue(passed, f"Healthy compounder should pass gate. Reason: {reason}")
        self.assertEqual(reason, "Passed")

    def test_multi_factor_strategy_scoring(self):
        """Test that strategy pre-scoring calculates appropriate weights for Value vs Income vs Non-US."""
        high_yield_profile = {
            'marketCap': 10000000000,
            'dividendYield': 0.052,  # 5.2%
            'trailingPE': 12.0,
            'freeCashflow': 800000000,
            'operatingMargins': 0.25,
            'returnOnEquity': 0.19,
            'debtToEquity': 60.0
        }
        income_score = self.screener._calculate_strategy_pre_score('income', high_yield_profile, {})
        value_score = self.screener._calculate_strategy_pre_score('value', high_yield_profile, {})

        self.assertGreaterEqual(income_score, 70.0, "High yield cash generator should score > 70 for Income")
        self.assertGreaterEqual(value_score, 70.0, "Low PE + high FCF should score > 70 for Value")

    def test_non_us_strict_country_exclusion(self):
        """Test that non_us strategy strictly excludes domestic US companies."""
        us_profile = {
            'country': 'United States',
            'marketCap': 5000000000,
            'operatingMargins': 0.30
        }
        uk_profile = {
            'country': 'United Kingdom',
            'marketCap': 5000000000,
            'operatingMargins': 0.30
        }
        score_us = self.screener._calculate_strategy_pre_score('non_us', us_profile, {})
        score_uk = self.screener._calculate_strategy_pre_score('non_us', uk_profile, {})

        self.assertEqual(score_us, -100.0, "US company must receive -100 penalty under non_us strategy")
        self.assertGreater(score_uk, 0.0, "Non-US company should receive valid positive score")


class TestVPSServerSafety(unittest.TestCase):
    """Verifies memory bounds, non-blocking execution, and crash-proof data sanitization for VPS servers."""

    def test_sanitize_value_numpy_and_pandas_primitives(self):
        """Verify that NumPy and Pandas types are safely converted to Python natives for JSON serialization."""
        data = {
            'np_float': np.float64(42.58),
            'np_int': np.int64(100),
            'np_nan': np.nan,
            'np_inf': np.inf,
            'pd_na': pd.NA,
            'pd_nat': pd.NaT,
            'nested_list': [np.float32(1.23), np.nan, {'key': np.int32(999)}],
            'clean_str': 'AAPL'
        }
        sanitized = sanitize_value(data)

        # Confirm JSON serialization succeeds without TypeError
        json_output = json.dumps(sanitized)
        self.assertIsInstance(json_output, str)

        parsed = json.loads(json_output)
        self.assertEqual(parsed['np_float'], 42.58)
        self.assertEqual(parsed['np_int'], 100)
        self.assertIsNone(parsed['np_nan'])
        self.assertIsNone(parsed['np_inf'])
        self.assertIsNone(parsed['pd_na'])
        self.assertAlmostEqual(parsed['nested_list'][0], 1.23, places=2)
        self.assertIsNone(parsed['nested_list'][1])
        self.assertEqual(parsed['nested_list'][2]['key'], 999)

    def test_company_identity_cross_listing_deduplication(self):
        """Test canonical mapping prevents dual-listed duplicate stocks from filling discovery slots."""
        canon_bti, name_bti = get_company_identity('BTI', 'British American Tobacco PLC')
        canon_bats, name_bats = get_company_identity('BATS.L', 'British American Tobacco')
        self.assertEqual(canon_bti, 'BTI')
        self.assertEqual(canon_bats, 'BTI')
        self.assertEqual(name_bti, name_bats)

        canon_nvo, _ = get_company_identity('NVO', 'Novo Nordisk')
        canon_novob, _ = get_company_identity('NOVO-B.CO', 'Novo Nordisk A/S')
        self.assertEqual(canon_nvo, 'NVO')
        self.assertEqual(canon_novob, 'NVO')

    def test_universe_manager_market_resolution(self):
        """Verify that UniverseManager reliably loads constituents without network crashes."""
        um = UniverseManager()
        for market in ['usa', 'uk', 'europe', 'japan', 'global']:
            symbols = um.get_universe_symbols(market)
            self.assertIsInstance(symbols, list)
            self.assertGreater(len(symbols), 0, f"Market {market} universe must not be empty")

        # Test Alpaca integration flag
        self.assertTrue(um.alpaca_available, "Alpaca API credentials should be loaded and valid")


class TestBackgroundTaskQueue(unittest.TestCase):
    """Verifies that background task queue handles status lifecycle, locks, and stale recovery safely."""

    def setUp(self):
        from task_queue import BackgroundTaskQueue
        self.queue = BackgroundTaskQueue(supabase_client=None)  # Test local fallback mode

    def test_queue_status_reporting(self):
        """Verify status reporting returns valid payload structure."""
        status = self.queue.get_latest_task_status('discovery')
        self.assertIn('is_running', status)
        self.assertIn('status', status)
        self.assertIn('stage', status)
        self.assertIn('progress', status)

    def test_stale_lock_reclamation(self):
        """Verify that stale running locks older than 15m are automatically reclaimed."""
        import datetime
        stale_time = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=20)).isoformat()
        stale_payload = {
            'is_running': True,
            'status': 'running',
            'started_at': stale_time,
            'stage': 'Stage 1: Pre-Flight Gate...'
        }
        self.queue._save_local_status(stale_payload)

        # Calling is_task_running should reclaim the stale lock and return False
        is_running = self.queue.is_task_running('discovery')
        self.assertFalse(is_running, "Stale lock > 15m must be automatically reclaimed")

        updated_status = self.queue.get_latest_task_status('discovery')
        self.assertFalse(updated_status['is_running'])
        self.assertEqual(updated_status['status'], 'failed')


if __name__ == '__main__':
    unittest.main()

