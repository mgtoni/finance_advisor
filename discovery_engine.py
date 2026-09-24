import os
import json
import re
import concurrent.futures
import time
import numpy as np
import pandas as pd
import yfinance as yf
import google.generativeai as genai
from quant_engine import QuantEngineService
from portfolio_manager import PortfolioManagerService
from news_aggregator import NewsAggregatorService
from utils import get_yf_ticker
from dotenv import load_dotenv

load_dotenv()

DISCOVERY_CACHE_FILE = os.path.join(os.path.dirname(__file__), 'discovery_cache.json')


def get_company_identity(sym, info=None):
    """
    Returns (canonical_base, normalized_name) to reliably identify cross-listed stocks,
    ADRs, and multi-class shares of the exact same underlying company across global markets.
    """
    if not sym:
        return '', ''
    sym_str = str(sym).strip().upper()
    base_sym = sym_str.split('.')[0]
    CROSS_LIST_MAP = {
        'BATS': 'BTI', 'BTI': 'BTI',
        'NOVO-B': 'NVO', 'NVO': 'NVO',
        'ATCO-A': 'ATCO', 'ATCO-B': 'ATCO', 'ATCO': 'ATCO',
        'VOLV-A': 'VOLV', 'VOLV-B': 'VOLV', 'VOLV': 'VOLV',
        'SAN': 'SNY', 'SNY': 'SNY',
        'NESN': 'NSRGY', 'NSRGY': 'NSRGY',
        'NOVN': 'NVS', 'NVS': 'NVS',
        'ROG': 'RHHBY', 'RHHBY': 'RHHBY',
        'ULVR': 'UL', 'UL': 'UL',
        'BP': 'BP',
        'SHEL': 'SHEL',
        'RIO': 'RIO',
        'BHP': 'BHP',
        'SAP': 'SAP',
        'ASML': 'ASML',
        'AZN': 'AZN',
        'GSK': 'GSK',
        'ALV': 'ALV',
        'BAS': 'BAS',
        'MC': 'LVMH', 'LVMUY': 'LVMH',
        'OR': 'OR', 'LRLCY': 'OR',
        'CDI': 'CDI', 'CHDRY': 'CDI',
        'RMS': 'RMS', 'HESAY': 'RMS',
        'AIR': 'AIR', 'EADSY': 'AIR',
        'DTE': 'DTE', 'DTEGY': 'DTE',
        'BMW': 'BMW', 'BMWYY': 'BMW',
        'MBG': 'MBG', 'MBGAF': 'MBG',
        'ENGI': 'ENGI', 'ENGIY': 'ENGI',
        'VIE': 'VIE', 'VEOEY': 'VIE',
        'DG': 'DG', 'VNCIY': 'DG',
        'CAP': 'CAP', 'CGEMY': 'CAP',
        'HEIA': 'HEIA', 'HEINY': 'HEIA',
        'WKL': 'WKL', 'WTKWY': 'WKL',
        'DSV': 'DSV', 'DSDVY': 'DSV',
        'KNEBV': 'KNEBV', 'KNYJY': 'KNEBV',
        'SAND': 'SAND', 'SDVKY': 'SAND',
        'ASSA-B': 'ASSA', 'ASAZY': 'ASSA',
        'DNB': 'DNB', 'DNBBY': 'DNB',
        'EQNR': 'EQNR',
        'RY': 'RY',
        'TD': 'TD',
        'BNS': 'BNS',
        'TRP': 'TRP',
        'CSU': 'CSU',
        'OTEX': 'OTEX',
        'WCN': 'WCN',
        'NTR': 'NTR',
        'CSL': 'CSL', 'CSLYY': 'CSL',
        'WES': 'WES', 'WFAFY': 'WES',
        'WOW': 'WOW', 'BMRNY': 'WOW',
        'FMG': 'FMG', 'FSUGY': 'FMG',
        'TSM': 'TSM',
        'INFY': 'INFY',
        'VALE': 'VALE',
        'MELI': 'MELI',
        'CRH': 'CRH',
        'FMX': 'FMX',
        'GRMN': 'GRMN'
    }
    canonical_base = CROSS_LIST_MAP.get(base_sym, base_sym)
    
    clean_name = ''
    if info and isinstance(info, dict):
        raw_name = info.get('shortName') or info.get('longName') or ''
        clean = re.sub(
            r'[\s\.\,\-]+(plc|inc|incorporated|corp|corporation|ltd|limited|ag|se|sa|nv|holdings|group|a\/s|ab|ord|ordinary|shares|company|co|the|- new york|adr).*$',
            '', raw_name.lower()
        )
        clean_name = re.sub(r'[^a-z0-9]', '', clean)[:10]
        
    return canonical_base, clean_name


def sanitize_value(val):
    """Safely converts NumPy/Pandas types and NaNs to standard Python primitives."""
    if val is None:
        return None
    if isinstance(val, (bool, str)):
        return val
    if isinstance(val, (float, np.floating)):
        return None if (pd.isna(val) or np.isnan(val) or np.isinf(val)) else float(round(val, 4))
    if isinstance(val, (int, np.integer)):
        return int(val)
    if isinstance(val, dict):
        return {str(k): sanitize_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [sanitize_value(v) for v in val]
    if pd.isna(val):
        return None
    return str(val)

class DiscoveryEngineService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        # Mandatory GEMINI.md rule: gemini-3.8-flash
        self.model = genai.GenerativeModel('gemini-3.8-flash')
        self.quant_svc = QuantEngineService()
        self.portfolio_svc = PortfolioManagerService(supabase_client=self.supabase)
        self.news_svc = NewsAggregatorService(supabase_client=self.supabase)

    # -------------------------------------------------------------------------
    # GLOBAL UNIVERSE POOLS (Deduplicated across Direct & ADR Listings)
    # -------------------------------------------------------------------------
    UNIVERSE_POOLS = {
        # High quality non-US operators, hidden champions, and mid/large-caps
        'non_us': [
            # Germany
            'SIE.DE', 'SAP.DE', 'ALV.DE', 'SY1.DE', 'BEI.DE', 'HEI.DE', 'EVK.DE', 'FRE.DE', 'QIA.DE', 'BNR.DE',
            # UK
            'AZN.L', 'RELX.L', 'HLMA.L', 'SGE.L', 'AUTO.L', 'WTB.L', 'BME.L', 'CPG.L', 'EXPN.L', 'RIO.L', 'SHEL.L', 'GSK.L', 'BATS.L',
            # France & Benelux
            'SAN.PA', 'MC.PA', 'AIR.PA', 'DG.PA', 'CAP.PA', 'ENGI.PA', 'VIE.PA', 'ASML.AS', 'WKL.AS', 'HEIA.AS',
            # Switzerland & Scandinavia
            'NOVN.SW', 'ABB.SW', 'NESN.SW', 'SIKA.SW', 'ASSA-B.ST', 'SAND.ST', 'DSV.CO', 'KNEBV.HE', 'DNB.OL', 'EQNR.OL',
            # Japan
            '6902.T', '6501.T', '4063.T', '8001.T', '8058.T', '9432.T', '4502.T', '7751.T', '6301.T', '7267.T',
            # Canada & Australia
            'RY.TO', 'CSU.TO', 'OTEX.TO', 'WCN.TO', 'NTR.TO', 'BNS.TO', 'TRP.TO', 'BHP.AX', 'CSL.AX', 'WES.AX', 'WOW.AX', 'FMG.AX',
            # Unique International ADRs (where local ticker is not already present)
            'TSM', 'NVO', 'DEO', 'TD', 'MELI', 'CRH', 'INFY', 'VALE', 'GRMN', 'FMX'
        ],
        'value': [
            'CVS', 'PFE', 'KMB', 'GIS', 'ADM', 'BG', 'CAG', 'TSN', 'MHK', 'BWA', 'WHR', 'APA', 'DVN', 'FANG', 'MOS', 'CF', 'FMC',
            'VALE', 'DEO', 'STLA', 'BBVA', 'DTE.DE', 'BNP.PA', 'ENGI.PA', 'OTEX.TO', 'BME.L', 'ALV.DE', 'BNS.TO',
            'DNB.OL', 'KCO.DE', 'HEI.DE', 'EVK.DE', 'WTB.L', 'BDEV.L', '7267.T', '6301.T'
        ],
        'income': [
            'O', 'MAIN', 'ABBV', 'VICI', 'STAG', 'EPD', 'ET', 'MO', 'ENB', 'PFE', 'VZ', 'T', 'KMI', 'WMB', 'OKE',
            'RY.TO', 'BNS.TO', 'TRP.TO', 'BATS.L', 'SHEL.L', 'AZN.L', 'ALV.DE', 'BAS.DE', 'RIO.L', 'EQNR.OL', 'DNB.OL',
            'HEIA.AS', 'DEO', 'SAN.PA', '9432.T', 'WES.AX', 'WOW.AX'
        ],
        'reduce_risk': [
            'WM', 'RSG', 'CL', 'PG', 'JNJ', 'PEP', 'KO', 'MCD', 'WMT', 'SO', 'DUK', 'AEP', 'NEE', 'XEL', 'ED', 'EIX',
            'NESN.SW', 'NOVN.SW', 'ROG.SW', 'ULVR.L', 'AZN.L', 'SAN.PA', 'BEI.DE', 'KNEBV.HE', 'WKL.AS', 'RY.TO', 'CSL.AX'
        ],
        'high_beta': [
            'CELH', 'DUOL', 'PLTR', 'IOT', 'SYM', 'PATH', 'CRWD', 'NET', 'FSLR', 'ENPH', 'STEM', 'RIVN', 'IONQ', 'ASTS', 'JOBY', 'TEM',
            'ADYEN.AS', 'SE', 'MELI', 'AIXA.DE', 'SHOP', 'FMG.AX'
        ],
        'diversification': [
            'RIO.L', 'BHP.AX', 'VALE', 'NTR.TO', 'EIX', 'SO', 'WM', 'OTEX.TO', 'DEO', 'BATS.L', 'AZN.L', 'SAP.DE', '6902.T',
            'SAN.PA', 'CSL.AX', 'TRP.TO', 'DSV.CO', 'ASSA-B.ST', 'HEI.DE', 'SY1.DE', 'NOVN.SW'
        ]
    }


    # -------------------------------------------------------------------------
    # 1. PORTFOLIO GAPS & EXPOSURE ANALYSIS
    # -------------------------------------------------------------------------
    def analyze_portfolio_profile(self):
        """Analyzes current holdings to detect sector gaps, country concentration, and beta."""
        try:
            if not self.supabase:
                return {"sector_weights": {}, "country_weights": {}, "existing_symbols": []}
            
            res = self.supabase.table('portfolio_summary').select('*').execute()
            holdings = res.data if res.data else []
            if not holdings:
                return {"sector_weights": {}, "country_weights": {}, "existing_symbols": []}

            existing_symbols = [h['symbol'] for h in holdings]
            sector_counts = {}
            country_counts = {}
            total_val = 0.0

            for item in holdings:
                sym = item.get('symbol')
                val = float(item.get('total_shares', 0) or 0) * float(item.get('last_close_price', 0) or 0)
                total_val += val
                try:
                    info = yf.Ticker(get_yf_ticker(sym)).info
                    sec = info.get('sector', 'Other')
                    country = info.get('country', 'US')
                    sector_counts[sec] = sector_counts.get(sec, 0.0) + val
                    country_counts[country] = country_counts.get(country, 0.0) + val
                except Exception:
                    pass

            sector_weights = {k: (v / total_val) * 100 if total_val > 0 else 0 for k, v in sector_counts.items()}
            country_weights = {k: (v / total_val) * 100 if total_val > 0 else 0 for k, v in country_counts.items()}

            return {
                "sector_weights": sector_weights,
                "country_weights": country_weights,
                "existing_symbols": existing_symbols
            }
        except Exception as e:
            print(f"Error analyzing portfolio profile: {e}")
            return {"sector_weights": {}, "country_weights": {}, "existing_symbols": []}

    # -------------------------------------------------------------------------
    # 2. MULTI-SOURCE CANDIDATE GATHERING (Large-Scale Scanning)
    # -------------------------------------------------------------------------
    def gather_candidate_pool(self, strategy='non_us', region_preference='all', market_cap_tier='all', listing_type='hybrid', portfolio_profile=None):
        """Gathers a massive candidate pool (50-100+ tickers) across curated pools, screeners, and Gemini."""
        print(f"Gathering candidate pool for strategy: '{strategy}', region: '{region_preference}', cap: '{market_cap_tier}'...")
        candidates = set()

        # A. Curated Universe Pool for the Strategy
        base_pool = self.UNIVERSE_POOLS.get(strategy, self.UNIVERSE_POOLS['non_us'])
        candidates.update(base_pool)

        # If diversification or non_us, blend in complementary pools
        if strategy in ['diversification', 'non_us']:
            candidates.update(self.UNIVERSE_POOLS['non_us'][:25])
        elif strategy in ['value', 'income']:
            candidates.update(self.UNIVERSE_POOLS['value'][:20])
            candidates.update(self.UNIVERSE_POOLS['income'][:20])
        elif strategy == 'reduce_risk':
            candidates.update(self.UNIVERSE_POOLS['reduce_risk'][:20])

        # B. Live yfinance Screeners (Only run for US-compatible strategies)
        is_non_us = (strategy == 'non_us') or (region_preference in ['global_ex_us', 'europe_uk', 'asia_pacific'])
        if not is_non_us:
            try:
                if strategy in ['value', 'income']:
                    undervalued = yf.screen('undervalued_growth_stocks')
                    if isinstance(undervalued, dict) and 'quotes' in undervalued:
                        for q in undervalued['quotes'][:15]:
                            candidates.add(q['symbol'])
                elif strategy == 'high_beta':
                    small_caps = yf.screen('aggressive_small_caps')
                    if isinstance(small_caps, dict) and 'quotes' in small_caps:
                        for q in small_caps['quotes'][:15]:
                            candidates.add(q['symbol'])
                    tech_growth = yf.screen('growth_technology_stocks')
                    if isinstance(tech_growth, dict) and 'quotes' in tech_growth:
                        for q in tech_growth['quotes'][:15]:
                            candidates.add(q['symbol'])
            except Exception as e:
                print(f"yfinance screener query notice: {e}")

        # C. Gemini 3.8 Flash Gap & Hidden Gem Identification
        try:
            gap_context = ""
            if portfolio_profile and portfolio_profile.get("country_weights"):
                gap_context = f"Current portfolio exposures: Countries: {portfolio_profile.get('country_weights')}, Sectors: {portfolio_profile.get('sector_weights')}."

            non_us_constraint = ""
            if is_non_us:
                non_us_constraint = """
                CRITICAL CONSTRAINT: You MUST STRICTLY EXCLUDE ALL UNITED STATES (US) COMPANIES.
                Do NOT suggest any companies headquartered in the USA.
                Suggest ONLY companies headquartered in Europe, UK, Japan, Asia-Pacific, Canada, Latin America, or Australia.
                """

            ai_instruction = f"""
            You are an elite institutional global equity research director.
            Identify 15 to 20 exceptional international or non-traditional stocks matching:
            - Strategy: {strategy}
            - Region Focus: {region_preference}
            - Market Cap Focus: {market_cap_tier} (Note: Mid-caps ($1B-$15B) and undervalued large caps are welcome, but DO NOT return the obvious mega-cap US tech monopolies like AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA).
            {non_us_constraint}
            {gap_context}
            
            Focus on companies with strong free cash flow, solid balance sheets, and compelling competitive moats (e.g. Nordic champions, UK specialists, German Mittelstand leaders, Canadian/Australian compounders, Japanese cash-rich firms, or undervalued international cash cows).
            Return ONLY a JSON array of valid Yahoo Finance ticker strings.
            Examples: ["OTEX.TO", "HLMA.L", "SY1.DE", "CSU.TO", "KNEBV.HE", "RIO.L", "6902.T"]
            """
            res = self.model.generate_content(
                contents=[ai_instruction, f"Strategy: {strategy}, Region: {region_preference}"],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.4
                )
            )
            ai_tickers = json.loads(res.text)
            if isinstance(ai_tickers, list):
                for t in ai_tickers:
                    if isinstance(t, str):
                        candidates.add(t.strip().upper())
                print(f"Gemini suggested {len(ai_tickers)} specialized candidates.")
        except Exception as e:
            print(f"Error running Gemini candidate generation: {e}")

        # Exclude stocks already in active portfolio
        existing = set(portfolio_profile.get('existing_symbols', [])) if portfolio_profile else set()
        clean_candidates = [c for c in candidates if c not in existing]

        # Filter listing type (ADR vs Direct) & pre-deduplicate
        if listing_type == 'direct_only':
            clean_candidates = [c for c in clean_candidates if '.' in c]
        elif listing_type == 'adrs_only':
            clean_candidates = [c for c in clean_candidates if '.' not in c]
        else:
            # Hybrid: deduplicate tickers that share the same canonical company base
            seen_bases = {}
            for c in clean_candidates:
                base = get_company_identity(c)[0]
                if base not in seen_bases:
                    seen_bases[base] = c
                else:
                    # Prefer local direct listing with exchange dot if available
                    if '.' not in seen_bases[base] and '.' in c:
                        seen_bases[base] = c
            clean_candidates = list(seen_bases.values())

        print(f"Total raw candidate pool assembled: {len(clean_candidates)} tickers.")
        return clean_candidates

    # -------------------------------------------------------------------------
    # 3. PARALLEL QUANTITATIVE AUDIT & FINANCIAL HEALTH GATE
    # -------------------------------------------------------------------------
    def _fetch_single_info(self, symbol):
        """Fetches ticker info with error tolerance."""
        try:
            yf_sym = get_yf_ticker(symbol)
            ticker = yf.Ticker(yf_sym)
            info = ticker.info
            if not info or not (info.get('regularMarketPrice') or info.get('previousClose') or info.get('currentPrice')):
                return None
            return symbol, info
        except Exception:
            return None

    def audit_and_filter_candidates(self, candidates, strategy='non_us', market_cap_tier='all', region_preference='all', strict_health=True):
        """Audits candidate pool in parallel against financial health gates and computes preliminary health scores."""
        print(f"Auditing {len(candidates)} candidates in parallel...")
        audited = []
        seen_identities = set()
        seen_names = set()

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_symbol = {executor.submit(self._fetch_single_info, sym): sym for sym in candidates}
            for future in concurrent.futures.as_completed(future_to_symbol):
                res = future.result()
                if not res:
                    continue
                sym, info = res
                
                # Deduplication Gate across cross-listed shares / ADRs
                canon_base, clean_name = get_company_identity(sym, info)
                if canon_base in seen_identities:
                    continue
                if clean_name and clean_name in seen_names:
                    continue

                mcap = info.get('marketCap') or 0
                country = info.get('country') or 'Unknown'
                fcf = info.get('freeCashflow')
                op_cf = info.get('operatingCashflow')
                trailing_pe = info.get('trailingPE')
                debt_equity = info.get('debtToEquity')
                div_yield = info.get('dividendYield')
                beta = info.get('beta')

                # Market Cap Tier Filtering
                # As requested by user: 'look at large cap in case any have reasonable valuations'
                if market_cap_tier == 'hidden_gems':
                    # Exclude giant mega-caps (> $25B)
                    if mcap > 25_000_000_000:
                        continue
                elif market_cap_tier == 'large_cap':
                    # Require mcap >= $12B and reasonable valuation
                    if mcap < 12_000_000_000:
                        continue
                    if trailing_pe and trailing_pe > 30:
                        continue

                # Strict Regionality Filtering
                is_non_us_requested = (strategy == 'non_us') or (region_preference in ['global_ex_us', 'europe_uk', 'asia_pacific'])
                if is_non_us_requested:
                    if country in ['United States', 'USA', 'US']:
                        continue
                    if country in ['Unknown', '', None] and '.' not in sym:
                        continue

                if region_preference == 'europe_uk':
                    eur_countries = ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Switzerland', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Spain', 'Italy', 'Belgium', 'Ireland', 'Austria']
                    eur_suffixes = ['.L', '.DE', '.PA', '.AS', '.SW', '.ST', '.CO', '.OL', '.HE', '.MC', '.MI']
                    if country not in eur_countries and not any(sym.endswith(ext) for ext in eur_suffixes):
                        continue
                elif region_preference == 'asia_pacific':
                    asia_countries = ['Japan', 'Australia', 'Hong Kong', 'Singapore', 'Taiwan', 'South Korea', 'India', 'New Zealand']
                    asia_suffixes = ['.T', '.AX', '.HK', '.SI', '.KS']
                    if country not in asia_countries and not any(sym.endswith(ext) for ext in asia_suffixes):
                        continue

                # Financial Health Quality Gate
                if strict_health and strategy != 'high_beta':
                    # 1. Cash flow positive check (Operating or Free Cash Flow must be > 0)
                    if fcf is not None and fcf < 0 and op_cf is not None and op_cf < 0:
                        continue

                    
                    # 2. Valuation sanity check (avoid negative earnings or astronomical multiples)
                    if trailing_pe is not None:
                        if trailing_pe < 0:
                            continue
                        if strategy == 'value' and trailing_pe > 20:
                            continue
                        if strategy in ['income', 'reduce_risk'] and trailing_pe > 28:
                            continue
                        if trailing_pe > 45: # General sanity ceiling
                            continue

                    # 3. Solvency sanity check (debt-to-equity should not be toxic > 3.0 unless financial/bank)
                    sec = info.get('sector', '')
                    if sec not in ['Financial Services', 'Utilities', 'Real Estate'] and debt_equity is not None and debt_equity > 300:
                        continue

                # Strategy-specific gates
                if strategy == 'income':
                    if div_yield is None or div_yield < 0.02: # at least 2% dividend yield
                        continue
                elif strategy == 'reduce_risk':
                    if beta is not None and beta > 0.95: # low beta
                        continue
                elif strategy == 'high_beta':
                    if beta is not None and beta < 1.15: # high beta / high volatility
                        continue

                # Passed all gates: record to deduplication tracking
                seen_identities.add(canon_base)
                if clean_name:
                    seen_names.add(clean_name)

                # Calculate Preliminary Fundamental Health Score (0-100)
                f_score = self.compute_fundamental_score(info, strategy)
                audited.append({
                    'symbol': sym,
                    'info': info,
                    'fundamental_score': f_score
                })

        print(f"Candidates passing health gate: {len(audited)} stocks.")
        # Sort by fundamental score and retain top 10 for deep analysis
        audited.sort(key=lambda x: x['fundamental_score'], reverse=True)
        return audited[:10]

    # -------------------------------------------------------------------------
    # 4. MULTI-PILLAR SCORING (Fundamentals, Technicals, Sentiment)
    # -------------------------------------------------------------------------
    def compute_fundamental_score(self, info, strategy='non_us'):
        """Computes a normalized Fundamental Health Score (0 to 100)."""
        score = 0.0
        
        # 1. Profitability & Margins (0-25 pts)
        op_margin = info.get('operatingMargins')
        if op_margin is not None:
            if op_margin > 0.20:
                score += 12.5
            elif op_margin > 0.10:
                score += 8.0
            elif op_margin > 0:
                score += 4.0

        roe = info.get('returnOnEquity')
        if roe is not None:
            if roe > 0.15:
                score += 12.5
            elif roe > 0.08:
                score += 8.0
            elif roe > 0:
                score += 4.0

        # 2. Cash Generation & FCF Yield (0-25 pts)
        fcf = info.get('freeCashflow')
        mcap = info.get('marketCap') or 1
        if fcf and fcf > 0:
            score += 15.0
            fcf_yield = (fcf / mcap) * 100
            if fcf_yield > 6.0:
                score += 10.0
            elif fcf_yield > 3.0:
                score += 5.0
        elif info.get('operatingCashflow') and info.get('operatingCashflow') > 0:
            score += 10.0

        # 3. Solvency & Balance Sheet (0-25 pts)
        debt_eq = info.get('debtToEquity')
        sec = info.get('sector', '')
        if sec in ['Financial Services', 'Real Estate']:
            score += 18.0
        elif debt_eq is not None:
            if debt_eq < 50:
                score += 25.0
            elif debt_eq < 100:
                score += 20.0
            elif debt_eq < 160:
                score += 12.0
            elif debt_eq < 250:
                score += 5.0
        else:
            score += 15.0

        # 4. Valuation Sanity (0-25 pts)
        pe = info.get('trailingPE') or info.get('forwardPE')
        if pe is not None and pe > 0:
            if pe < 12:
                score += 25.0
            elif pe < 18:
                score += 20.0
            elif pe < 25:
                score += 14.0
            elif pe < 35:
                score += 6.0
        else:
            score += 10.0

        return min(max(round(score, 1), 0.0), 100.0)

    def compute_technical_score(self, symbol):
        """Runs multi-timeframe Quant Engine and normalizes technical score to 0-100."""
        try:
            scores = self.quant_svc.calculate_composite_score(symbol)
            comp = scores.get('composite_score', 0.0)
            # Normalize -1.0..+1.0 to 0..100
            norm_score = round((comp + 1.0) * 50.0, 1)
            return min(max(norm_score, 0.0), 100.0), scores
        except Exception as e:
            print(f"Error computing technical score for {symbol}: {e}")
            return 50.0, {'composite_score': 0.0, 'daily_score': 0.0, 'weekly_score': 0.0}

    def compute_sentiment_score(self, symbol, info):
        """Scrapes news headlines, runs sentiment analysis and evaluates analyst targets."""
        sentiment_data = {
            'analyst_target': sanitize_value(info.get('targetMeanPrice')),
            'upside_pct': None,
            'recommendation': info.get('recommendationKey', 'N/A'),
            'analyst_opinions': info.get('numberOfAnalystOpinions', 0),
            'news_sentiment': 0.0,
            'recent_headlines': []
        }

        # 1. Analyst Upside Calculation
        current_price = info.get('regularMarketPrice') or info.get('currentPrice') or info.get('previousClose')
        target_price = info.get('targetMeanPrice')
        analyst_pts = 20.0

        if current_price and target_price and current_price > 0:
            upside = ((target_price - current_price) / current_price) * 100.0
            sentiment_data['upside_pct'] = round(upside, 1)
            if upside > 30.0:
                analyst_pts = 40.0
            elif upside > 15.0:
                analyst_pts = 32.0
            elif upside > 0.0:
                analyst_pts = 24.0
            else:
                analyst_pts = 10.0

        # Recommendation rating
        rec = str(info.get('recommendationKey', '')).lower()
        if 'buy' in rec:
            analyst_pts += 15.0
        elif 'hold' in rec:
            analyst_pts += 8.0

        # 2. Live News Headlines & AI Sentiment
        try:
            raw_news = self.news_svc.fetch_yahoo_news(symbol)
            if raw_news:
                scored_news = self.news_svc.analyze_sentiment(symbol, raw_news[:4])
                avg_sent = 0.0
                valid_count = 0
                for item in scored_news:
                    score = item.get('sentiment_score')
                    if score is not None:
                        avg_sent += float(score)
                        valid_count += 1
                    sentiment_data['recent_headlines'].append({
                        'headline': item.get('headline', ''),
                        'source': item.get('source', 'Yahoo Finance'),
                        'impact': item.get('impact_summary', '')
                    })
                if valid_count > 0:
                    avg_sent /= valid_count
                    sentiment_data['news_sentiment'] = round(avg_sent, 2)
                    news_pts = (avg_sent + 1.0) * 22.5 # 0 to 45 pts
                else:
                    news_pts = 22.5
            else:
                news_pts = 22.5
        except Exception as e:
            print(f"Notice fetching news for {symbol}: {e}")
            news_pts = 22.5

        sentiment_score = min(max(round(analyst_pts + news_pts, 1), 0.0), 100.0)
        sentiment_data['score'] = sentiment_score
        return sentiment_score, sentiment_data

    # -------------------------------------------------------------------------
    # 5. IN-DEPTH INSTITUTIONAL DOSSIER SYNTHESIS (GEMINI 3.8 FLASH)
    # -------------------------------------------------------------------------
    def generate_institutional_dossier(self, pick, strategy, portfolio_gaps):
        """Generates a deep, institutional-grade due diligence dossier per GEMINI.md rules."""
        system_instruction = """
        You are an elite Senior Portfolio Manager & Global Equity Research Director.
        Provide a rigorous, institutional-grade research dossier for the selected stock.
        
        CRITICAL RULES (Strict GEMINI.md Invariants):
        - Honest, Objective & Critical Feedback: Highlight vulnerabilities, macro headwinds, and competitive risks realistically. Avoid sycophancy or fluff.
        - Substantive depth: Provide actionable takeaways and specific insights.
        - If it is a non-US company, explicitly analyze currency (FX) risks, regulatory environments, and trade dynamics.
        
        Output strictly as JSON matching this schema:
        {
            "hidden_gem_factor": "Detailed paragraph explaining why this company is overlooked, mispriced, or a superior compounder (moat, niche leadership, pricing power, restructuring).",
            "investment_thesis": [
                "Detailed takeaway 1 on business model and structural growth",
                "Detailed takeaway 2 on competitive advantage and market share",
                "Detailed takeaway 3 on cash flow conversion and capital allocation"
            ],
            "financial_health_summary": [
                "Evaluation of Free Cash Flow, margins, and operational efficiency",
                "Balance sheet leverage, debt serviceability, and liquidity position"
            ],
            "portfolio_synergy": "Detailed paragraph explaining how this stock specifically hedges current portfolio gaps (missing sectors/countries) and reduces correlation.",
            "technical_timing": "Assessment of entry timing based on technical momentum, support levels, and squeeze condition.",
            "bear_case": [
                "Vulnerability 1: Macro or sector specific headwind",
                "Vulnerability 2: Valuation, margin compression, or currency/regulatory risk"
            ]
        }
        """

        prompt = f"""
        Stock: {pick['symbol']} ({pick['company_name']}, Sector: {pick['sector']}, Country: {pick['country']})
        Strategy Goal: {strategy}
        Fundamental Score: {pick['fundamental_score']}/100
        Technical Score: {pick['technical_score']}/100
        Sentiment Score: {pick['sentiment_score']}/100
        Key Metrics:
        - P/E: {pick['fundamental_metrics'].get('trailing_pe')}, Forward P/E: {pick['fundamental_metrics'].get('forward_pe')}
        - Free Cash Flow: {pick['fundamental_metrics'].get('free_cashflow')}
        - Operating Margin: {pick['fundamental_metrics'].get('operating_margin')}
        - Debt to Equity: {pick['fundamental_metrics'].get('debt_to_equity')}
        - Dividend Yield: {pick['fundamental_metrics'].get('dividend_yield')}
        - Beta: {pick['fundamental_metrics'].get('beta')}
        - Analyst Target: {pick['sentiment_data'].get('analyst_target')} (Upside: {pick['sentiment_data'].get('upside_pct')}%)
        
        Current Portfolio Allocation Context:
        {json.dumps(portfolio_gaps)}
        """

        try:
            res = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.25
                )
            )
            return json.loads(res.text)
        except Exception as e:
            print(f"Error generating dossier for {pick['symbol']}: {e}")
            return {
                "hidden_gem_factor": f"{pick['company_name']} displays resilient operational performance and attractive risk-adjusted valuation.",
                "investment_thesis": [
                    f"Strong positioning within {pick['sector']} sector.",
                    "Fills critical portfolio diversification void with positive cash flows."
                ],
                "financial_health_summary": ["Positive cash flows and sound balance sheet."],
                "portfolio_synergy": "Hedges portfolio concentration away from domestic US assets.",
                "technical_timing": "Solid momentum configuration.",
                "bear_case": ["Subject to broader macroeconomic contraction and currency volatility."]
            }

    # -------------------------------------------------------------------------
    # 6. MAIN ORCHESTRATOR
    # -------------------------------------------------------------------------
    def run_discovery(self, strategy='non_us', market_cap_tier='all', region_preference='all', listing_type='hybrid', strict_health=True):
        """Runs the complete multi-pillar Discovery & Due Diligence Pipeline."""
        print(f"\n=== LAUNCHING GLOBAL AI DISCOVERY ENGINE ===")
        print(f"Strategy: {strategy} | Cap: {market_cap_tier} | Region: {region_preference} | Type: {listing_type}")
        t_start = time.time()

        # Step 1: Portfolio Profiling
        portfolio_profile = self.analyze_portfolio_profile()

        # Step 2: Broad Candidate Gathering (50-100+ stocks)
        raw_candidates = self.gather_candidate_pool(
            strategy=strategy,
            region_preference=region_preference,
            market_cap_tier=market_cap_tier,
            listing_type=listing_type,
            portfolio_profile=portfolio_profile
        )

        if not raw_candidates:
            print("No candidates found matching criteria.")
            return []

        # Step 3: Fast Parallel Health Audit & Gate
        survivors = self.audit_and_filter_candidates(
            raw_candidates,
            strategy=strategy,
            market_cap_tier=market_cap_tier,
            region_preference=region_preference,
            strict_health=strict_health
        )

        if not survivors:
            print("No survivors passed health gate. Falling back to top 3 raw candidates.")
            survivors = [{'symbol': s, 'info': yf.Ticker(get_yf_ticker(s)).info, 'fundamental_score': 65.0} for s in raw_candidates[:3]]

        # Step 4: Deep Multi-Pillar Due Diligence (Technicals & Sentiment)
        print("Conducting deep multi-pillar analysis on top candidates...")
        deep_picks = []

        # Strategy weightings for Composite Score
        weights = {
            'value': (0.50, 0.30, 0.20),
            'income': (0.50, 0.25, 0.25),
            'reduce_risk': (0.45, 0.35, 0.20),
            'diversification': (0.40, 0.35, 0.25),
            'non_us': (0.40, 0.35, 0.25),
            'high_beta': (0.25, 0.50, 0.25)
        }
        fw, tw, sw = weights.get(strategy, (0.40, 0.35, 0.25))

        for item in survivors[:6]: # Analyze up to top 6
            sym = item['symbol']
            info = item['info']
            f_score = item['fundamental_score']

            # Technical Score
            t_score, tech_details = self.compute_technical_score(sym)

            # Sentiment Score
            s_score, sent_details = self.compute_sentiment_score(sym, info)

            # Composite Score (0-100)
            composite_score = round((f_score * fw) + (t_score * tw) + (s_score * sw), 1)

            # Extract clean fundamental metrics
            fund_metrics = {
                'market_cap': sanitize_value(info.get('marketCap')),
                'trailing_pe': sanitize_value(info.get('trailingPE')),
                'forward_pe': sanitize_value(info.get('forwardPE')),
                'price_to_book': sanitize_value(info.get('priceToBook')),
                'free_cashflow': sanitize_value(info.get('freeCashflow')),
                'operating_cashflow': sanitize_value(info.get('operatingCashflow')),
                'debt_to_equity': sanitize_value(info.get('debtToEquity')),
                'return_on_equity': sanitize_value(info.get('returnOnEquity')),
                'operating_margin': sanitize_value(info.get('operatingMargins')),
                'dividend_yield': sanitize_value(info.get('dividendYield')),
                'payout_ratio': sanitize_value(info.get('payoutRatio')),
                'beta': sanitize_value(info.get('beta')),
                'currency': info.get('currency', 'USD')
            }

            clean_pick = {
                'symbol': sym,
                'company_name': info.get('longName') or info.get('shortName') or sym,
                'sector': info.get('sector', 'Unknown'),
                'country': info.get('country', 'Unknown'),
                'exchange': info.get('exchange', 'Unknown'),
                'strategy': strategy,
                'fundamental_score': f_score,
                'technical_score': t_score,
                'sentiment_score': s_score,
                'composite_score': composite_score,
                'fundamental_metrics': fund_metrics,
                'technical_scores': sanitize_value(tech_details),
                'sentiment_data': sanitize_value(sent_details)
            }
            deep_picks.append(clean_pick)

        # Rank by composite score and pick top 3 distinct companies
        deep_picks.sort(key=lambda x: x['composite_score'], reverse=True)
        top_picks = []
        final_identities = set()
        final_names = set()
        for dp in deep_picks:
            cb, cn = get_company_identity(dp['symbol'], {'shortName': dp['company_name'], 'longName': dp['company_name']})
            if cb in final_identities or (cn and cn in final_names):
                continue
            final_identities.add(cb)
            if cn:
                final_names.add(cn)
            top_picks.append(dp)
            if len(top_picks) >= 3:
                break

        # Step 5: Institutional Dossier Synthesis via Gemini 3.8 Flash
        print(f"Generating institutional dossiers for top {len(top_picks)} draft picks...")
        final_picks = []
        for pick in top_picks:
            dossier = self.generate_institutional_dossier(pick, strategy, portfolio_profile)
            
            # Combine dossier into pick
            pick['dossier'] = sanitize_value(dossier)
            # Store summary points in top-level thesis for backward compatibility
            summary_points = dossier.get('investment_thesis', [])
            pick['thesis_points'] = summary_points
            
            # Full structured payload stored in thesis JSONB
            pick['full_thesis_payload'] = {
                'points': summary_points,
                'strategy': strategy,
                'country': pick['country'],
                'exchange': pick['exchange'],
                'market_cap': pick['fundamental_metrics'].get('market_cap'),
                'fundamental_score': pick['fundamental_score'],
                'technical_score': pick['technical_score'],
                'sentiment_score': pick['sentiment_score'],
                'composite_score': pick['composite_score'],
                'fundamental_metrics': pick['fundamental_metrics'],
                'technical_scores': pick['technical_scores'],
                'sentiment_data': pick['sentiment_data'],
                'dossier': dossier
            }
            final_picks.append(pick)

        # Step 6: Save to Supabase and Local Cache
        self._persist_discovery_picks(final_picks)

        elapsed = round(time.time() - t_start, 2)
        print(f"=== DISCOVERY COMPLETE ({elapsed}s). Top Picks: {[p['symbol'] for p in final_picks]} ===")
        return final_picks

    def _persist_discovery_picks(self, picks):
        """Persists picks to Supabase and writes local cache."""
        # 1. Local Cache file
        try:
            cache_payload = {
                'last_updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'picks': [sanitize_value(p) for p in picks]
            }
            with open(DISCOVERY_CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache_payload, f, indent=2)
        except Exception as ce:
            print(f"Warning writing local discovery cache: {ce}")

        # 2. Supabase Upsert / Deduplication
        if not self.supabase or not picks:
            return

        for p in picks:
            try:
                norm_quant = round((p['composite_score'] - 50.0) / 50.0, 2)
                
                db_record = {
                    'symbol': p['symbol'],
                    'company_name': p['company_name'],
                    'sector': p['sector'],
                    'quant_score': norm_quant,
                    'thesis': p['full_thesis_payload']
                }

                # Try inserting extended columns if table has them
                extended_fields = {
                    'strategy': p['strategy'],
                    'country': p['country'],
                    'exchange': p['exchange'],
                    'market_cap': p['fundamental_metrics'].get('market_cap'),
                    'fundamental_metrics': p['fundamental_metrics'],
                    'technical_scores': p['technical_scores'],
                    'sentiment_data': p['sentiment_data'],
                    'composite_score': p['composite_score']
                }
                full_record = {**db_record, **extended_fields}

                # Check if exact symbol already exists in Supabase
                existing = self.supabase.table('discovery_picks').select('id, symbol').eq('symbol', p['symbol']).execute()
                if existing.data and len(existing.data) > 0:
                    rec_id = existing.data[0]['id']
                    try:
                        self.supabase.table('discovery_picks').update(full_record).eq('id', rec_id).execute()
                    except Exception:
                        self.supabase.table('discovery_picks').update(db_record).eq('id', rec_id).execute()
                    continue

                # Check if cross-listed symbol of the same company exists under this strategy
                cb, cn = get_company_identity(p['symbol'], {'shortName': p['company_name'], 'longName': p['company_name']})
                strat_picks = self.supabase.table('discovery_picks').select('id, symbol, company_name').eq('strategy', p['strategy']).execute()
                replaced = False
                if strat_picks.data:
                    for sp in strat_picks.data:
                        sp_cb, sp_cn = get_company_identity(sp['symbol'], {'shortName': sp.get('company_name'), 'longName': sp.get('company_name')})
                        if sp_cb == cb or (cn and sp_cn and sp_cn == cn):
                            try:
                                self.supabase.table('discovery_picks').update(full_record).eq('id', sp['id']).execute()
                            except Exception:
                                self.supabase.table('discovery_picks').update(db_record).eq('id', sp['id']).execute()
                            replaced = True
                            break

                if not replaced:
                    try:
                        self.supabase.table('discovery_picks').insert(full_record).execute()
                    except Exception:
                        # Fallback to standard schema if extended columns not yet migrated
                        self.supabase.table('discovery_picks').insert(db_record).execute()

            except Exception as e:
                print(f"Error persisting pick {p['symbol']} to Supabase: {e}")


if __name__ == "__main__":
    from main import get_supabase_client
    svc = DiscoveryEngineService(supabase_client=get_supabase_client())
    picks = svc.run_discovery(strategy='non_us', market_cap_tier='hidden_gems', region_preference='europe_uk')
    print("Test Complete. Pick count:", len(picks))
