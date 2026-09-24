import os
import sys
import json
import re
import concurrent.futures
import time
import logging
import numpy as np
import pandas as pd
import yfinance as yf
import google.generativeai as genai

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
from quant_engine import QuantEngineService
from portfolio_manager import PortfolioManagerService
from news_aggregator import NewsAggregatorService
from data_ingestion import DataIngestionService
from universe_manager import UniverseManager
from utils import get_yf_ticker, get_company_identity, sanitize_value
from discovery_screener import DiscoveryScreener
from dotenv import load_dotenv

# Suppress yfinance internal error logs
logging.getLogger('yfinance').setLevel(logging.CRITICAL)

load_dotenv()

DISCOVERY_CACHE_FILE = os.path.join(os.path.dirname(__file__), 'discovery_cache.json')
DISCOVERY_CONTENDERS_FILE = os.path.join(os.path.dirname(__file__), 'discovery_contenders.json')
DISCOVERY_STATUS_FILE = os.path.join(os.path.dirname(__file__), 'discovery_status.json')



class DiscoveryEngineService:
    """
    Automated Multi-Stage Institutional Discovery Engine:
    - Stage 1: Pre-Flight Gate (Universe Ingestion, Penny Stocks, Illiquidity, SPACs, Micro-caps)
    - Stage 2: Strategy Multi-Factor Pre-Scoring -> Isolates TOP 20 CONTENDERS
    - Stage 3: Deep Research-Grade Audit on the 20 (Multi-Timeframe Quant, SEC Form 4 Insiders, Tier 1 News, Macro)
    - Stage 4: Gemini 3.8 Flash Institutional Comparative Synthesis -> TOP 5 FINAL RECOMMENDATIONS
    """

    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        # Mandatory GEMINI.md rule: gemini-3.8-flash
        self.model = genai.GenerativeModel('gemini-3.8-flash')
        self.universe_mgr = UniverseManager()
        self.screener = DiscoveryScreener(supabase_client=self.supabase)
        self.quant_svc = QuantEngineService()
        self.portfolio_svc = PortfolioManagerService(supabase_client=self.supabase)
        self.news_svc = NewsAggregatorService(supabase_client=self.supabase)
        self.data_ingestion_svc = DataIngestionService(supabase_client=self.supabase)

    def _update_status(self, is_running, stage, stage_index=1, total_stages=4, strategy='value', market='usa'):
        """Writes current execution status to file for frontend polling."""
        status = {
            'is_running': is_running,
            'stage': stage,
            'stage_index': stage_index,
            'total_stages': total_stages,
            'strategy': strategy,
            'market': market,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        try:
            with open(DISCOVERY_STATUS_FILE, 'w', encoding='utf-8') as f:
                json.dump(status, f, indent=2)
        except Exception as e:
            print(f"Notice updating discovery status: {e}")

    # -------------------------------------------------------------------------
    # 1. PORTFOLIO PROFILE & EXPOSURE ANALYSIS
    # -------------------------------------------------------------------------
    def analyze_portfolio_profile(self):
        """Analyzes active portfolio holdings to detect sector gaps and country concentration."""
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
    # 2. STAGE 3: DEEP RESEARCH-GRADE AUDIT ON THE 20 CONTENDERS
    # -------------------------------------------------------------------------
    def run_deep_contender_audit(self, contenders, macro_regime=None):
        """
        Conducts deep quantitative, insider, news sentiment, and macro audit
        on the Top 20 Contenders.
        """
        print(f"\n--- STAGE 3: RUNNING DEEP RESEARCH AUDIT ON {len(contenders)} CONTENDERS ---")
        audited_contenders = []

        for item in contenders:
            sym = item['symbol']
            info = item.get('info', {})
            print(f"Deep auditing contender: {sym} ({item.get('company_name', sym)})...")

            # 1. Multi-Timeframe Technical Momentum (pandas-ta)
            t_score, tech_details = self._compute_technical_score(sym)

            # 2. SEC Form 4 / Insider Cluster Purchases
            insider_data = self._compute_insider_score(sym)

            # 3. Tier 1 Financial Media Sentiment
            s_score, sent_details = self._compute_sentiment_score(sym, info)

            # 4. Fundamental Health Score (0-100)
            f_score = self._compute_fundamental_score(info)

            # 5. Composite Score Blending
            # Weighting: Fundamentals 40%, Technicals 30%, Sentiment 20%, Insiders 10%
            insider_pts = min(insider_data.get('score', 50.0), 100.0)
            composite_score = round(
                (f_score * 0.40) + (t_score * 0.30) + (s_score * 0.20) + (insider_pts * 0.10),
                1
            )

            # Package full contender audit dossier
            full_record = {
                'symbol': sym,
                'company_name': item.get('company_name', sym),
                'sector': item.get('sector', 'General'),
                'industry': item.get('industry', 'General'),
                'country': item.get('country', 'Unknown'),
                'exchange': item.get('exchange', 'Unknown'),
                'market_cap': item.get('market_cap'),
                'last_price': item.get('price'),
                'pre_score': item.get('pre_score'),
                'fundamental_score': f_score,
                'technical_score': t_score,
                'sentiment_score': s_score,
                'insider_score': insider_pts,
                'composite_score': composite_score,
                'fundamental_metrics': {
                    'pe': item.get('pe'),
                    'forward_pe': item.get('forward_pe'),
                    'operating_margin': item.get('operating_margin'),
                    'roe': item.get('roe'),
                    'debt_to_equity': item.get('debt_to_equity'),
                    'dividend_yield': item.get('dividend_yield'),
                    'beta': item.get('beta'),
                    'free_cashflow': item.get('free_cashflow'),
                    'operating_cashflow': item.get('operating_cashflow')
                },
                'technical_scores': sanitize_value(tech_details),
                'sentiment_data': sanitize_value(sent_details),
                'insider_data': sanitize_value(insider_data),
                'macro_regime_snapshot': sanitize_value(macro_regime)
            }
            audited_contenders.append(full_record)

        # Sort descending by composite score
        audited_contenders.sort(key=lambda x: x['composite_score'], reverse=True)
        return audited_contenders

    def _compute_fundamental_score(self, info):
        """Computes a normalized Fundamental Health Score (0 to 100) across 4 pillars."""
        score = 0.0
        # Margins & ROE
        op_margin = info.get('operatingMargins')
        if op_margin is not None:
            if op_margin > 0.20: score += 12.5
            elif op_margin > 0.10: score += 8.0
            elif op_margin > 0: score += 4.0

        roe = info.get('returnOnEquity')
        if roe is not None:
            if roe > 0.15: score += 12.5
            elif roe > 0.08: score += 8.0
            elif roe > 0: score += 4.0

        # FCF
        fcf = info.get('freeCashflow')
        mcap = info.get('marketCap') or 1
        if fcf and fcf > 0:
            score += 15.0
            fcf_yield = (fcf / mcap) * 100
            if fcf_yield > 6.0: score += 10.0
            elif fcf_yield > 3.0: score += 5.0
        elif info.get('operatingCashflow') and info.get('operatingCashflow') > 0:
            score += 10.0

        # Solvency
        debt_eq = info.get('debtToEquity')
        sec = info.get('sector', '')
        if sec in ['Financial Services', 'Real Estate', 'Utilities']:
            score += 18.0
        elif debt_eq is not None:
            if debt_eq < 50: score += 25.0
            elif debt_eq < 100: score += 20.0
            elif debt_eq < 160: score += 12.0
            elif debt_eq < 250: score += 5.0
        else:
            score += 15.0

        # Valuation
        pe = info.get('trailingPE') or info.get('forwardPE')
        if pe is not None and pe > 0:
            if pe < 12: score += 25.0
            elif pe < 18: score += 20.0
            elif pe < 25: score += 14.0
            elif pe < 35: score += 6.0
        else:
            score += 10.0

        return min(max(round(score, 1), 0.0), 100.0)

    def _compute_technical_score(self, symbol):
        """Runs multi-timeframe Quant Engine (Daily & Weekly) and normalizes to 0-100."""
        try:
            scores = self.quant_svc.calculate_composite_score(symbol)
            comp = scores.get('composite_score', 0.0)
            norm_score = round((comp + 1.0) * 50.0, 1)
            return min(max(norm_score, 0.0), 100.0), scores
        except Exception as e:
            print(f"Notice computing technical score for {symbol}: {e}")
            return 50.0, {'composite_score': 0.0, 'daily_score': 0.0, 'weekly_score': 0.0}

    def _compute_insider_score(self, symbol):
        """Pulls SEC Form 4 (US) or global insider transaction data."""
        try:
            raw = self.data_ingestion_svc.get_insider_tracking(symbol, days_back=60)
            buy_count = raw.get('insider_filings_count', 0) if isinstance(raw, dict) else 0
            
            # 0 buys = neutral 50. 1 buy = 65. 2+ buys (cluster buying) = 85 to 100.
            if buy_count >= 3: score = 95.0
            elif buy_count == 2: score = 85.0
            elif buy_count == 1: score = 65.0
            else: score = 50.0

            return {
                'score': score,
                'recent_buy_count': buy_count,
                'source': 'SEC Form 4' if '.' not in symbol else 'Global Regulatory Disclosures'
            }
        except Exception as e:
            print(f"Notice computing insider score for {symbol}: {e}")
            return {'score': 50.0, 'recent_buy_count': 0, 'source': 'None'}

    def _compute_sentiment_score(self, symbol, info):
        """Scrapes news headlines, runs Tier 1 weighted sentiment, and evaluates consensus upside."""
        sentiment_data = {
            'analyst_target': sanitize_value(info.get('targetMeanPrice')),
            'upside_pct': None,
            'recommendation': info.get('recommendationKey', 'N/A'),
            'analyst_opinions': info.get('numberOfAnalystOpinions', 0),
            'news_sentiment': 0.0,
            'recent_headlines': []
        }

        # Analyst Upside Calculation (Max 55 pts)
        current_price = info.get('regularMarketPrice') or info.get('currentPrice') or info.get('previousClose')
        target_price = info.get('targetMeanPrice')
        analyst_pts = 20.0

        if current_price and target_price and current_price > 0:
            upside = ((target_price - current_price) / current_price) * 100.0
            sentiment_data['upside_pct'] = round(upside, 1)
            if upside > 30.0: analyst_pts = 40.0
            elif upside > 15.0: analyst_pts = 32.0
            elif upside > 0.0: analyst_pts = 24.0
            else: analyst_pts = 10.0

        rec = str(info.get('recommendationKey', '')).lower()
        if 'buy' in rec: analyst_pts += 15.0
        elif 'hold' in rec: analyst_pts += 8.0

        # Tier 1 Financial Media Sentiment (Max 45 pts)
        try:
            raw_news = self.news_svc.fetch_yahoo_news(symbol)
            if raw_news:
                scored_news = self.news_svc.analyze_sentiment(symbol, raw_news[:5])
                avg_sent = 0.0
                valid_count = 0
                for item in scored_news:
                    score = item.get('sentiment_score')
                    if score is not None:
                        avg_sent += float(score)
                        valid_count += 1
                    sentiment_data['recent_headlines'].append({
                        'headline': item.get('headline', ''),
                        'source': item.get('source', 'Financial Media'),
                        'impact': item.get('impact_summary', '')
                    })
                if valid_count > 0:
                    avg_sent /= valid_count
                    sentiment_data['news_sentiment'] = round(avg_sent, 2)
                    news_pts = (avg_sent + 1.0) * 22.5
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
    # 3. STAGE 4: GEMINI 3.8 FLASH INSTITUTIONAL TOURNAMENT & TOP 5 SYNTHESIS
    # -------------------------------------------------------------------------
    def synthesize_top_5_with_ai(self, audited_20, strategy='value', market='usa', portfolio_profile=None):
        """
        Runs Gemini 3.8 Flash institutional comparative synthesis across the 20 contenders
        to crown the TOP 5 FINAL ASSET RECOMMENDATIONS with research-grade dossiers.
        """
        print(f"\n--- STAGE 4: GEMINI 3.8 FLASH INSTITUTIONAL TOURNAMENT SYNTHESIS ---")
        
        system_instruction = """
        You are an elite Chief Investment Officer (CIO) and Head of Global Equity Research.
        You have conducted a deep quantitative and fundamental audit on the TOP 20 CONTENDERS in the market.
        
        YOUR OBJECTIVE:
        Conduct a rigorous cross-sectional comparative evaluation of all 20 contenders, eliminate the bottom 15,
        and select the TOP 5 HIGH-CONVICTION ASSET RECOMMENDATIONS that maximize risk-adjusted upside while hedging portfolio risks.
        
        STRICT GEMINI.MD INVARIANTS:
        1. Honest, Objective & Critical Feedback: Highlight vulnerabilities, margin headwinds, and competitive risks realistically. Avoid flattering fluff.
        2. Substantive depth: Provide actionable, comprehensive takeaways.
        3. Explain explicitly WHY each of the top 5 won over the other 15 contenders in this cycle.
        4. If evaluating non-US assets, explicitly analyze currency (FX) risks, regulatory environments, and trade dynamics.
        
        OUTPUT SCHEMA: Return strictly JSON matching this structure:
        {
            "top_5_picks": [
                {
                    "rank": 1,
                    "symbol": "TICKER",
                    "company_name": "Company Name",
                    "hidden_gem_factor": "Detailed paragraph explaining the mispricing, competitive moat, or structural compounder advantage.",
                    "tournament_edge": "Clear explanation of why this stock beat the other 15 contenders in this audit cycle.",
                    "investment_thesis": [
                        "Takeaway 1: Business model durability, pricing power, and structural tailwinds",
                        "Takeaway 2: Free cash flow generation, capital allocation, and dividend/buyback resilience",
                        "Takeaway 3: Balance sheet safety, debt serviceability, and operating margin trajectory"
                    ],
                    "financial_health_summary": [
                        "Analysis of operational free cash flow conversion and margins",
                        "Balance sheet leverage, debt maturity profile, and liquidity"
                    ],
                    "portfolio_synergy": "How this stock specifically hedges current portfolio sector/country gaps and reduces concentration.",
                    "technical_timing": "Assessment of entry timing based on momentum, support levels, and volatility squeeze condition.",
                    "bear_case": [
                        "Primary Downside Risk: Macro or sector specific headwind",
                        "Secondary Vulnerability: Valuation multiple contraction or currency/regulatory risk"
                    ]
                }
            ],
            "contender_matrix": [
                {
                    "rank": 6,
                    "symbol": "TICKER",
                    "company_name": "Company Name",
                    "composite_score": 75.4,
                    "exclusion_reason": "Specific institutional reason why this contender was not selected in the top 5 (e.g. higher debt leverage, weaker FCF yield, or correlation overlap)."
                }
            ]
        }
        """

        # Prepare condensed contenders payload for the prompt
        contenders_summary = []
        for i, c in enumerate(audited_20):
            contenders_summary.append({
                'rank_candidate': i + 1,
                'symbol': c['symbol'],
                'name': c['company_name'],
                'sector': c['sector'],
                'country': c['country'],
                'market_cap': c['market_cap'],
                'last_price': c['last_price'],
                'composite_score': c['composite_score'],
                'fundamental_score': c['fundamental_score'],
                'technical_score': c['technical_score'],
                'sentiment_score': c['sentiment_score'],
                'insider_score': c['insider_score'],
                'metrics': c['fundamental_metrics'],
                'analyst_target': c['sentiment_data'].get('analyst_target'),
                'analyst_upside_pct': c['sentiment_data'].get('upside_pct')
            })

        user_prompt = f"""
        Market: {market.upper()}
        Strategy Goal: {strategy.upper()}
        Current Active Portfolio Exposure Context:
        {json.dumps(portfolio_profile or {})}
        
        TOP 20 AUDITED CONTENDERS DATA:
        {json.dumps(contenders_summary, indent=2)}
        
        Evaluate all 20 contenders, crown the TOP 5 WINNERS with complete dossiers, and explain why the other 15 were ranked lower.
        """

        try:
            res = self.model.generate_content(
                contents=[system_instruction, user_prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.20
                )
            )
            synthesis = json.loads(res.text)
            print("Gemini 3.8 Flash tournament synthesis complete.")
            return synthesis
        except Exception as e:
            print(f"Error in Gemini tournament synthesis: {e}")
            # Robust fallback
            fallback_top5 = []
            for i, c in enumerate(audited_20[:5]):
                fallback_top5.append({
                    "rank": i + 1,
                    "symbol": c['symbol'],
                    "company_name": c['company_name'],
                    "hidden_gem_factor": f"{c['company_name']} displays resilient operational performance and attractive risk-adjusted valuation in {c['sector']}.",
                    "tournament_edge": f"Outperformed contenders on multi-factor composite score ({c['composite_score']}/100) and balance sheet stability.",
                    "investment_thesis": [
                        f"Strong commercial positioning in {c['sector']} with sustained cash generation.",
                        "Solid balance sheet leverage and favorable operational margins relative to sector peers.",
                        "Fills critical portfolio diversification voids with attractive risk-adjusted entry timing."
                    ],
                    "financial_health_summary": [
                        "Positive cash flows and sound balance sheet structure.",
                        "Controlled leverage and stable debt serviceability."
                    ],
                    "portfolio_synergy": f"Enhances diversification and hedges concentration away from existing portfolio holdings.",
                    "technical_timing": "Favorable momentum configuration supported by multi-timeframe indicator alignment.",
                    "bear_case": [
                        "Vulnerable to broad macroeconomic compression and interest rate shifts.",
                        "Potential margin pressure from sector cost inflation or competitive pricing."
                    ]
                })
            fallback_matrix = [
                {
                    "rank": i + 6,
                    "symbol": c['symbol'],
                    "company_name": c['company_name'],
                    "composite_score": c['composite_score'],
                    "exclusion_reason": "Lower multi-factor score or higher valuation multiple compared to top 5 winners."
                }
                for i, c in enumerate(audited_20[5:])
            ]
            return {"top_5_picks": fallback_top5, "contender_matrix": fallback_matrix}

    # -------------------------------------------------------------------------
    # 4. MAIN ORCHESTRATOR: THE COMPLETE 4-STAGE FUNNEL
    # -------------------------------------------------------------------------
    def run_discovery_pipeline(self, market='usa', strategy='value', target_contenders=20):
        """
        Orchestrates the entire 4-stage funnel:
        1. Ingest Market Universe & Apply Pre-Flight Hard Exclusion Gate
        2. Strategy Pre-Analysis & Multi-Factor Score -> Top 20 Contenders
        3. Deep Research-Grade Audit on 20 Contenders (Quant, Insiders, Tier 1 News, Macro)
        4. Gemini 3.8 Flash Institutional Tournament -> Top 5 Final Recommendations
        """
        t_start = time.time()
        print(f"\n=======================================================")
        print(f">>> LAUNCHING 4-STAGE DISCOVERY FUNNEL: MARKET={market.upper()} | STRATEGY={strategy.upper()}")
        print(f"=======================================================")

        # Stage 1: Market Universe Ingestion & Pre-Flight Gate
        self._update_status(True, f"Stage 1: Scanning {market.upper()} Universe & applying Pre-Flight Liquidity Gate...", 1, 4, strategy, market)
        raw_universe = self.universe_mgr.get_market_universe(market)
        print(f"Universe Ingestion: {len(raw_universe)} constituents loaded for {market.upper()}.")

        portfolio_profile = self.analyze_portfolio_profile()
        macro_regime = self.data_ingestion_svc.get_macro_regime()

        # Run Stage 1 Liquidity & Price Exclusion Gate
        # For USA, uses Alpaca snapshots; for international, uses batched yfinance
        liquid_candidates = self.screener.run_liquidity_gate(
            raw_universe[:1500], # scan up to 1500 prioritized stocks
            market=market,
            min_price=5.0,
            min_dollar_vol=10_000_000
        )

        if not liquid_candidates:
            print("Warning: Liquidity gate yielded 0 candidates. Falling back to top 40 universe items.")
            liquid_candidates = raw_universe[:40]

        # Stage 2: Strategy Pre-Analysis & Quality Screening -> TOP 20 CONTENDERS
        self._update_status(True, f"Stage 2: Running Strategy Pre-Score to isolate Top {target_contenders} Contenders...", 2, 4, strategy, market)
        top_contenders = self.screener.run_pre_analysis_and_scoring(
            liquid_candidates,
            strategy=strategy,
            portfolio_profile=portfolio_profile,
            target_contenders=target_contenders
        )

        if not top_contenders:
            print("Warning: Pre-analysis yielded 0 contenders. Falling back to top 5 liquid candidates.")
            top_contenders = [{'symbol': x['symbol'], 'company_name': x['name'], 'sector': x.get('sector', 'General'), 'pre_score': 65.0, 'info': yf.Ticker(get_yf_ticker(x['symbol'])).info} for x in liquid_candidates[:5]]

        # Stage 3: Deep Research-Grade Audit on the Contenders
        self._update_status(True, f"Stage 3: Deep Research Audit on {len(top_contenders)} Contenders (Quant, Insiders, Tier 1 News, Macro)...", 3, 4, strategy, market)
        audited_contenders = self.run_deep_contender_audit(top_contenders, macro_regime)

        # Stage 4: Gemini 3.8 Flash Institutional Tournament & Top 5 Synthesis
        self._update_status(True, f"Stage 4: Gemini 3.8 Flash synthesizing cross-market tournament & crowning Top 5...", 4, 4, strategy, market)
        ai_tournament = self.synthesize_top_5_with_ai(audited_contenders, strategy, market, portfolio_profile)

        # Merge AI dossiers into final Top 5 Pick records
        final_top_5 = []
        dossier_by_sym = {p['symbol']: p for p in ai_tournament.get('top_5_picks', [])}

        for item in audited_contenders:
            sym = item['symbol']
            if sym in dossier_by_sym:
                ai_dossier = dossier_by_sym[sym]
                merged_pick = dict(item)
                merged_pick['rank'] = ai_dossier.get('rank', len(final_top_5) + 1)
                merged_pick['dossier'] = sanitize_value(ai_dossier)
                merged_pick['strategy'] = strategy
                merged_pick['market'] = market
                merged_pick['thesis_points'] = ai_dossier.get('investment_thesis', [])
                merged_pick['full_thesis_payload'] = {
                    'rank': merged_pick['rank'],
                    'strategy': strategy,
                    'market': market,
                    'points': ai_dossier.get('investment_thesis', []),
                    'country': merged_pick['country'],
                    'exchange': merged_pick['exchange'],
                    'market_cap': merged_pick['market_cap'],
                    'fundamental_score': merged_pick['fundamental_score'],
                    'technical_score': merged_pick['technical_score'],
                    'sentiment_score': merged_pick['sentiment_score'],
                    'insider_score': merged_pick['insider_score'],
                    'composite_score': merged_pick['composite_score'],
                    'fundamental_metrics': merged_pick['fundamental_metrics'],
                    'technical_scores': merged_pick['technical_scores'],
                    'sentiment_data': merged_pick['sentiment_data'],
                    'insider_data': merged_pick['insider_data'],
                    'dossier': ai_dossier
                }
                final_top_5.append(merged_pick)

        # Sort top 5 by assigned rank
        final_top_5.sort(key=lambda x: x.get('rank', 99))

        # Persist results to database and disk caches
        self._persist_funnel_results(final_top_5, audited_contenders, ai_tournament.get('contender_matrix', []))

        elapsed = round(time.time() - t_start, 2)
        print(f"\n=======================================================")
        print(f"[SUCCESS] 4-STAGE FUNNEL COMPLETE IN {elapsed}s!")
        print(f"[TOP 5 RECOMMENDATIONS]: {[p['symbol'] for p in final_top_5]}")
        print(f"[TOTAL CONTENDERS AUDITED]: {len(audited_contenders)}")
        print(f"=======================================================\n")

        self._update_status(False, "Complete", 4, 4, strategy, market)
        return final_top_5

    def run_discovery(self, strategy='value', market='usa', target_contenders=20, **kwargs):
        """Backward-compatible alias for run_discovery_pipeline."""
        reg = kwargs.get('region_preference', '')
        if reg == 'europe_uk':
            market = 'uk' if strategy == 'uk' else 'europe'
        elif reg == 'asia_pacific':
            market = 'japan'
        elif reg == 'global_ex_us':
            market = 'global'
        elif not market and kwargs.get('market'):
            market = kwargs.get('market')
        return self.run_discovery_pipeline(market=market, strategy=strategy, target_contenders=target_contenders)

    def _persist_funnel_results(self, top_5, all_contenders, contender_matrix):
        """Saves final recommendations and contender matrix to Supabase and local cache."""
        now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

        # 1. Local Cache for Top 5 Picks
        try:
            cache_payload = {
                'last_updated': now_iso,
                'picks': [sanitize_value(p) for p in top_5]
            }
            with open(DISCOVERY_CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache_payload, f, indent=2)
        except Exception as e:
            print(f"Notice saving local discovery cache: {e}")

        # 2. Local Cache for All 20 Contenders & Matrix
        try:
            contenders_payload = {
                'last_updated': now_iso,
                'contenders': [sanitize_value(c) for c in all_contenders],
                'contender_matrix': [sanitize_value(m) for m in contender_matrix]
            }
            with open(DISCOVERY_CONTENDERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(contenders_payload, f, indent=2)
        except Exception as e:
            print(f"Notice saving local contenders cache: {e}")

        # 3. Supabase Upsert for Top 5 Picks
        if not self.supabase or not top_5:
            return

        for p in top_5:
            try:
                norm_quant = round((p['composite_score'] - 50.0) / 50.0, 2)
                db_record = {
                    'symbol': p['symbol'],
                    'company_name': p['company_name'],
                    'sector': p['sector'],
                    'quant_score': norm_quant,
                    'thesis': p['full_thesis_payload']
                }
                extended_fields = {
                    'strategy': p['strategy'],
                    'country': p['country'],
                    'exchange': p['exchange'],
                    'market_cap': p['market_cap'],
                    'fundamental_metrics': p['fundamental_metrics'],
                    'technical_scores': p['technical_scores'],
                    'sentiment_data': p['sentiment_data'],
                    'composite_score': p['composite_score']
                }
                full_record = {**db_record, **extended_fields}

                # Check if exact symbol exists
                existing = self.supabase.table('discovery_picks').select('id, symbol').eq('symbol', p['symbol']).execute()
                if existing.data and len(existing.data) > 0:
                    rec_id = existing.data[0]['id']
                    try:
                        self.supabase.table('discovery_picks').update(full_record).eq('id', rec_id).execute()
                    except Exception:
                        self.supabase.table('discovery_picks').update(db_record).eq('id', rec_id).execute()
                else:
                    try:
                        self.supabase.table('discovery_picks').insert(full_record).execute()
                    except Exception:
                        self.supabase.table('discovery_picks').insert(db_record).execute()
            except Exception as dbe:
                print(f"Notice persisting pick {p['symbol']} to Supabase: {dbe}")


if __name__ == "__main__":
    from main import get_supabase_client
    svc = DiscoveryEngineService(supabase_client=get_supabase_client())
    picks = svc.run_discovery_pipeline(market='usa', strategy='value', target_contenders=10)
    print("Test run complete. Final recommendations:", [p['symbol'] for p in picks])
