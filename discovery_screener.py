import os
import time
import math
import concurrent.futures
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from utils import get_yf_ticker, get_company_identity, sanitize_value

load_dotenv()

class DiscoveryScreener:
    """
    Stage 1 & Stage 2 Funnel Screener:
    - Stage 1: Pre-Flight Hard Exclusion Gate (Penny stocks, Illiquidity, Micro-caps, SPACs, Zombie debt, OTC)
    - Stage 2: Strategy Multi-Factor Pre-Scoring -> Isolates the TOP 20 CONTENDERS
    """

    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        self.alpaca_key = os.getenv("ALPACA_API_KEY")
        self.alpaca_secret = os.getenv("ALPACA_SECRET_KEY")

    def run_liquidity_gate(self, universe_items, market='usa', min_price=5.0, min_dollar_vol=10_000_000):
        """
        Fast vectorized liquidity and price gate.
        Uses Alpaca bulk snapshots for USA where possible, and batched yfinance for international.
        Returns list of qualifying ticker dicts.
        """
        print(f"Running Stage 1 Liquidity & Price Gate on {len(universe_items)} stocks (Market: {market.upper()})...")
        qualified = []
        raw_symbols = [item['symbol'] for item in universe_items]
        symbol_meta = {item['symbol']: item for item in universe_items}

        if market == 'usa' and self.alpaca_key and self.alpaca_secret:
            # Use Alpaca bulk snapshots in batches of 50
            headers = {
                "APCA-API-KEY-ID": self.alpaca_key,
                "APCA-API-SECRET-KEY": self.alpaca_secret
            }
            batch_size = 50
            for i in range(0, len(raw_symbols), batch_size):
                chunk = raw_symbols[i:i + batch_size]
                chunk_str = ",".join(chunk)
                try:
                    res = requests.get(
                        f"https://data.alpaca.markets/v2/stocks/snapshots?symbols={chunk_str}",
                        headers=headers,
                        timeout=8
                    )
                    if res.status_code == 200:
                        data = res.json()
                        for sym, snap in data.items():
                            if not snap:
                                continue
                            daily_bar = snap.get('dailyBar') or snap.get('prevDailyBar') or {}
                            latest_trade = snap.get('latestTrade') or {}
                            price = latest_trade.get('p') or daily_bar.get('c') or 0.0
                            vol = daily_bar.get('v') or 0

                            dollar_vol = price * vol
                            if price >= min_price and dollar_vol >= min_dollar_vol:
                                meta = symbol_meta.get(sym, {'symbol': sym, 'name': sym, 'sector': 'General'})
                                meta['last_price'] = round(price, 2)
                                meta['est_dollar_volume'] = round(dollar_vol, 0)
                                qualified.append(meta)
                except Exception as e:
                    print(f"Notice during Alpaca snapshot batch {i}: {e}")
                # Brief sleep to be polite
                time.sleep(0.05)

        # Fallback or Non-US markets: Use batched yfinance downloads
        if not qualified or market != 'usa':
            # Adjust local currency price thresholds: £2 for UK, €3 for EUR, ¥500 for JPY
            local_min_price = min_price
            if market == 'uk':
                local_min_price = 2.0 # GBP (note UK stocks on yfinance are in GBp pence, handled below)
            elif market == 'europe':
                local_min_price = 3.0 # EUR
            elif market == 'japan':
                local_min_price = 500.0 # JPY

            batch_size = 40
            for i in range(0, min(len(raw_symbols), 600), batch_size):
                chunk = raw_symbols[i:i + batch_size]
                try:
                    df = yf.download(chunk, period="1mo", interval="1d", progress=False, group_by='ticker')
                    if df is not None and not df.empty:
                        for sym in chunk:
                            try:
                                if len(chunk) == 1:
                                    sub_df = df
                                else:
                                    if sym not in df.columns.levels[0]:
                                        continue
                                    sub_df = df[sym]

                                close_series = sub_df['Close'].dropna()
                                vol_series = sub_df['Volume'].dropna()
                                if close_series.empty or vol_series.empty:
                                    continue

                                last_close = float(close_series.iloc[-1])
                                avg_vol = float(vol_series.tail(15).mean())
                                
                                # Convert UK GBp (pence) to GBP for price checking
                                norm_price = last_close
                                if sym.endswith('.L'):
                                    norm_price = last_close / 100.0  # LSE quotes in pence sterling (GBX)

                                # Calculate estimated daily turnover in USD
                                dollar_vol = norm_price * avg_vol
                                if sym.endswith('.L'):
                                    dollar_vol = dollar_vol * 1.30  # GBP to USD (~1.30x)
                                elif any(sym.endswith(x) for x in ['.DE', '.PA', '.AS', '.MI', '.MC']):
                                    dollar_vol = dollar_vol * 1.08  # EUR to USD (~1.08x)
                                elif sym.endswith('.T'):
                                    dollar_vol = dollar_vol / 150.0  # JPY to USD (~1/150x)

                                if norm_price >= local_min_price and dollar_vol >= min_dollar_vol:
                                    meta = symbol_meta.get(sym, {'symbol': sym, 'name': sym, 'sector': 'General'})
                                    meta['last_price'] = round(norm_price, 2)
                                    meta['est_dollar_volume'] = round(dollar_vol, 0)
                                    qualified.append(meta)
                            except Exception:
                                continue
                except Exception as e:
                    print(f"Notice during yfinance batch download {i}: {e}")
                time.sleep(0.1)

        print(f"Stage 1 Gate complete: {len(qualified)} stocks passed liquidity and price floors.")
        return qualified

    def _fetch_candidate_financials(self, sym):
        """Pulls comprehensive fundamentals with error handling."""
        try:
            yf_sym = get_yf_ticker(sym)
            ticker = yf.Ticker(yf_sym)
            info = ticker.info
            if not info or not (info.get('regularMarketPrice') or info.get('previousClose') or info.get('currentPrice')):
                return None
            return sym, info
        except Exception:
            return None

    def evaluate_qualitative_financial_gate(self, sym, info, strategy='value', portfolio_profile=None, seen_identities=None, seen_names=None, strict=True):
        """
        Applies institutional qualitative & financial health filters:
        - Active portfolio exclusion
        - Cross-listing & dual-class deduplication
        - Market Cap floor ($1.5B US / £1.0B UK / €1.2B Europe / ¥180B Japan)
        - SPAC / shell company filter
        - Pre-revenue speculative biotech filter (<$50M revenue)
        - Zombie solvency trap filter (debt-to-equity > 300% & negative cash flow)
        - Valuation sanity filter (P/E sanity bounds)
        - Strategy specific requirements (Income yield, beta targets)
        
        Returns: (passed: bool, reason: str, canon_base: str, clean_name: str)
        """
        if not info:
            return False, "Missing company fundamental profile", sym, ""

        canon_base, clean_name = get_company_identity(sym, info)

        # 1. Active Portfolio Exclusion Gate
        existing_holdings = set(portfolio_profile.get('existing_symbols', [])) if portfolio_profile else set()
        if sym in existing_holdings:
            return False, f"Already in active portfolio ({sym})", canon_base, clean_name

        # 2. Canonical Identity Deduplication Gate
        if seen_identities is not None and canon_base in seen_identities:
            return False, f"Duplicate asset already captured ({canon_base})", canon_base, clean_name
        if seen_names is not None and clean_name and clean_name in seen_names:
            return False, f"Duplicate company name already captured ({clean_name})", canon_base, clean_name

        # 3. Market Cap Gate (USD-equivalent floor: $1.5B US, £1.0B UK, €1.2B Europe, ¥180B Japan)
        mcap = info.get('marketCap') or 0
        min_mcap = 1_500_000_000
        if sym.endswith('.L'):
            min_mcap = 1_000_000_000  # £1.0B GBP (~$1.3B USD)
        elif any(sym.endswith(x) for x in ['.DE', '.PA', '.AS', '.MI', '.MC']):
            min_mcap = 1_200_000_000  # €1.2B EUR (~$1.3B USD)
        elif sym.endswith('.T'):
            min_mcap = 180_000_000_000  # ¥180B JPY (~$1.2B USD)

        if mcap < min_mcap:
            return False, f"Below market cap floor (${mcap:,.0f})", canon_base, clean_name

        sec = info.get('sector', '')
        ind = info.get('industry', '')
        fcf = info.get('freeCashflow')
        op_cf = info.get('operatingCashflow')
        pe = info.get('trailingPE')
        debt_eq = info.get('debtToEquity')
        op_margin = info.get('operatingMargins')
        rev = info.get('totalRevenue') or 0
        div_yield = info.get('dividendYield')
        beta = info.get('beta')
        long_name = info.get('longName') or info.get('shortName') or ''
        summary = info.get('longBusinessSummary') or ''

        # 4. SPAC / Shell Company Gate
        if 'shell' in sec.lower() or 'blank check' in ind.lower() or 'acquisition' in long_name.lower() or 'blank check' in summary.lower():
            return False, "Blank check SPAC / shell company", canon_base, clean_name
        if rev == 0 and (op_cf is None or op_cf == 0):
            return False, "Zero revenue and zero operating cash flow", canon_base, clean_name

        # 5. Pre-Revenue Biotech Gate (< $50M rev & deep negative margin)
        if 'biotechnology' in ind.lower():
            if rev < 50_000_000 or (op_margin is not None and op_margin < -1.0):
                return False, f"Pre-revenue speculative biotech (Rev: ${rev:,.0f})", canon_base, clean_name

        # 6. Insolvency / Zombie Company Gate
        if sec not in ['Financial Services', 'Utilities', 'Real Estate']:
            if debt_eq is not None and debt_eq > 300:
                if fcf is not None and fcf < 0:
                    return False, f"Zombie solvency trap (Debt/Eq: {debt_eq:.1f}%, FCF: <0)", canon_base, clean_name
            if fcf is not None and fcf < 0 and op_cf is not None and op_cf < 0:
                return False, "Dual negative operating and free cash flow burn", canon_base, clean_name

        # 7. Valuation Sanity Gate
        if pe is not None:
            if pe < 0:
                return False, f"Negative earnings (P/E: {pe:.1f})", canon_base, clean_name
            if pe > 50:
                return False, f"Hyper-inflated valuation multiple (P/E: {pe:.1f})", canon_base, clean_name
            if strategy == 'value' and pe > 25:
                return False, f"P/E {pe:.1f} exceeds value strategy ceiling (25x)", canon_base, clean_name
            if strategy in ['income', 'reduce_risk'] and pe > 32:
                return False, f"P/E {pe:.1f} exceeds conservative ceiling (32x)", canon_base, clean_name

        # Strategy-specific gates
        if strategy == 'income' and (div_yield is None or div_yield < 0.02):
            return False, f"Dividend yield below 2.0% floor ({div_yield})", canon_base, clean_name
        if strategy == 'reduce_risk' and beta is not None and beta > 0.90:
            return False, f"Beta {beta:.2f} exceeds defensive ceiling (0.90)", canon_base, clean_name
        if strategy == 'high_beta' and beta is not None and beta < 1.10:
            return False, f"Beta {beta:.2f} below high beta floor (1.10)", canon_base, clean_name

        return True, "Passed", canon_base, clean_name

    def _qualitative_financial_gate(self, sym, info, strict=True):
        """Helper alias for unit tests."""
        passed, reason, _, _ = self.evaluate_qualitative_financial_gate(sym, info, strict=strict)
        return passed, reason

    def run_pre_analysis_and_scoring(self, qualified_candidates, strategy='value', portfolio_profile=None, target_contenders=20):
        """
        Stage 2: Applies quality gates (SPAC, Insolvency, Biotech) and calculates multi-factor score.
        Returns the sorted TOP 20 CONTENDERS.
        """
        print(f"Running Stage 2 Pre-Analysis on {len(qualified_candidates)} candidates for strategy: '{strategy}'...")
        audited = []
        seen_identities = set()
        seen_names = set()

        # Run parallel inspection across qualified candidates
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_sym = {
                executor.submit(self._fetch_candidate_financials, item['symbol']): item
                for item in qualified_candidates
            }

            for future in concurrent.futures.as_completed(future_to_sym):
                item = future_to_sym[future]
                res = future.result()
                if not res:
                    continue
                sym, info = res

                passed, reason, canon_base, clean_name = self.evaluate_qualitative_financial_gate(
                    sym, info, strategy=strategy, portfolio_profile=portfolio_profile,
                    seen_identities=seen_identities, seen_names=seen_names
                )
                if not passed:
                    continue

                # Passed all gates: record to deduplication set
                seen_identities.add(canon_base)
                if clean_name:
                    seen_names.add(clean_name)

                # Calculate Stage 2 Multi-Factor Pre-Score (0 to 100)
                pre_score = self._calculate_pre_score(info, strategy, portfolio_profile)

                sec = info.get('sector', '')
                ind = info.get('industry', '')
                fcf = info.get('freeCashflow')
                op_cf = info.get('operatingCashflow')
                pe = info.get('trailingPE')
                fwd_pe = info.get('forwardPE')
                debt_eq = info.get('debtToEquity')
                op_margin = info.get('operatingMargins')
                roe = info.get('returnOnEquity')
                mcap = info.get('marketCap') or 0
                div_yield = info.get('dividendYield')
                beta = info.get('beta')

                audited.append({
                    'symbol': sym,
                    'company_name': info.get('longName') or info.get('shortName') or sym,
                    'sector': sec or 'Unknown',
                    'industry': ind or 'Unknown',
                    'country': info.get('country') or 'Unknown',
                    'exchange': info.get('exchange') or 'Unknown',
                    'market_cap': sanitize_value(mcap),
                    'price': sanitize_value(info.get('regularMarketPrice') or info.get('currentPrice') or info.get('previousClose')),
                    'pe': sanitize_value(pe),
                    'forward_pe': sanitize_value(fwd_pe),
                    'operating_margin': sanitize_value(op_margin),
                    'roe': sanitize_value(roe),
                    'debt_to_equity': sanitize_value(debt_eq),
                    'dividend_yield': sanitize_value(div_yield),
                    'beta': sanitize_value(beta),
                    'free_cashflow': sanitize_value(fcf),
                    'operating_cashflow': sanitize_value(op_cf),
                    'pre_score': pre_score,
                    'info': info
                })

        print(f"Stage 2 Pre-Analysis: {len(audited)} candidates passed all qualitative and health gates.")
        # Sort descending by pre-score and retain the TOP 20 CONTENDERS
        audited.sort(key=lambda x: x['pre_score'], reverse=True)
        top_contenders = audited[:target_contenders]

        print(f"Selected TOP {len(top_contenders)} CONTENDERS: {[c['symbol'] for c in top_contenders]}")
        return top_contenders

    def _calculate_pre_score(self, info, strategy, portfolio_profile=None):
        """Calculates a multi-factor pre-score (0-100) combining Valuation, Profitability, Solvency, and Portfolio Fit."""
        # Non-US strict country penalty
        if strategy == 'non_us':
            c = (info.get('country') or '').lower()
            if c in ['united states', 'usa', 'us']:
                return -100.0

        score = 0.0

        # 1. Profitability & Margins (Max 30 pts)
        op_margin = info.get('operatingMargins')
        if op_margin is not None:
            if op_margin > 0.25: score += 15.0
            elif op_margin > 0.15: score += 12.0
            elif op_margin > 0.08: score += 7.0
            elif op_margin > 0: score += 3.0

        roe = info.get('returnOnEquity')
        if roe is not None:
            if roe > 0.20: score += 15.0
            elif roe > 0.12: score += 11.0
            elif roe > 0.05: score += 6.0
            elif roe > 0: score += 2.0

        # 2. Cash Flow & Capital Generation (Max 25 pts)
        sec = info.get('sector', '')
        if sec in ['Financial Services', 'Real Estate', 'Utilities']:
            # Financial institutions carry deposit/policyholder liabilities; reward ROE & Capital Efficiency instead of industrial FCF
            score += 15.0
            roe = info.get('returnOnEquity')
            if roe and roe > 0.15: score += 10.0
            elif roe and roe > 0.10: score += 7.0
            elif roe and roe > 0.05: score += 4.0
        else:
            fcf = info.get('freeCashflow')
            mcap = info.get('marketCap') or 1
            if fcf and fcf > 0:
                score += 15.0
                fcf_yield = (fcf / mcap) * 100
                if fcf_yield > 6.0: score += 10.0
                elif fcf_yield > 3.0: score += 6.0
                elif fcf_yield > 0: score += 3.0
            elif info.get('operatingCashflow') and info.get('operatingCashflow') > 0:
                score += 10.0

        # 3. Solvency & Balance Sheet (Max 20 pts)
        debt_eq = info.get('debtToEquity')
        if sec in ['Financial Services', 'Real Estate', 'Utilities']:
            score += 15.0
        elif debt_eq is not None:
            if debt_eq < 40: score += 20.0
            elif debt_eq < 80: score += 16.0
            elif debt_eq < 140: score += 10.0
            elif debt_eq < 220: score += 4.0
        else:
            score += 10.0

        # 4. Valuation & Strategy Specific Focus (Max 25 pts)
        pe = info.get('trailingPE') or info.get('forwardPE')
        if pe is not None and pe > 0:
            if strategy == 'value':
                if pe < 10: score += 25.0
                elif pe < 15: score += 20.0
                elif pe < 20: score += 14.0
                else: score += 5.0
            else:
                if pe < 14: score += 25.0
                elif pe < 20: score += 20.0
                elif pe < 28: score += 14.0
                elif pe < 38: score += 6.0
        else:
            score += 8.0

        # Income Strategy Boost
        if strategy == 'income':
            div = info.get('dividendYield') or 0.0
            if div > 0.05: score += 15.0
            elif div > 0.03: score += 10.0
            elif div > 0.02: score += 5.0

        # 5. Portfolio Synergy Bonus (Hedge against missing sectors)
        if portfolio_profile and portfolio_profile.get('sector_weights'):
            weights = portfolio_profile['sector_weights']
            current_sec_weight = weights.get(sec, 0.0)
            if current_sec_weight < 5.0: # Sector is under-represented in portfolio
                score += 5.0

        return min(max(round(score, 1), 0.0), 100.0)

    def _calculate_strategy_pre_score(self, strategy, info, portfolio_profile=None):
        """Helper alias for unit tests."""
        return self._calculate_pre_score(info, strategy, portfolio_profile)

if __name__ == '__main__':
    from universe_manager import UniverseManager
    mgr = UniverseManager()
    screener = DiscoveryScreener()

    # Test on UK market
    uk_universe = mgr.get_market_universe('uk')
    liquid = screener.run_liquidity_gate(uk_universe, market='uk')
    contenders = screener.run_pre_analysis_and_scoring(liquid, strategy='value', target_contenders=5)
    print("Contenders test passed. Count:", len(contenders))
