import os
import json
import requests
import google.generativeai as genai
from datetime import datetime
import yfinance as yf
import pandas as pd

class PortfolioManagerService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        # We use a pro model capable of deep reasoning and JSON schema output
        # Use gemini-3.8-flash as requested
        self.model = genai.GenerativeModel('gemini-3.8-flash')
        self.discord_webhook_url = os.getenv("DISCORD_WEBHOOK_URL")

    def get_position_context(self, symbol):
        """Fetches the current portfolio position context from Supabase."""
        if not self.supabase:
            # Mock data for local testing without Supabase
            return {
                'symbol': symbol,
                'total_shares': 100,
                'average_entry_price': 50.0,
                'total_unrealized_pnl_pct': 25.5
            }
        
        try:
            response = self.supabase.table('portfolio_summary').select('*').eq('symbol', symbol).execute()
            if response.data:
                return response.data[0]
        except Exception as e:
            print(f"Error fetching position for {symbol}: {e}")
            
        return None

    def get_fundamental_data(self, symbol):
        """Fetches fundamental data using yfinance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            return {
                'market_cap': info.get('marketCap'),
                'trailing_pe': info.get('trailingPE'),
                'forward_pe': info.get('forwardPE'),
                'price_to_book': info.get('priceToBook'),
                'debt_to_equity': info.get('debtToEquity'),
                'return_on_equity': info.get('returnOnEquity')
            }
        except Exception as e:
            print(f"Error fetching fundamentals for {symbol}: {e}")
            return {}

    def get_quarterly_financials(self, symbol):
        """Fetches quarterly financial statements from yfinance, using Supabase cache."""
        if self.supabase:
            try:
                # Check cache first
                res = self.supabase.table('financials_cache').select('*').eq('symbol', symbol).execute()
                if res.data and len(res.data) > 0:
                    cache_entry = res.data[0]
                    cached_data = cache_entry['quarterly_data']
                    last_updated = datetime.fromisoformat(cache_entry['last_updated'])
                    
                    # Smart caching: Check the date of the most recent quarter in the cache
                    if cached_data and len(cached_data) > 0:
                        latest_quarter_str = cached_data[0].get('date')
                        if latest_quarter_str:
                            latest_quarter_date = datetime.strptime(latest_quarter_str, '%Y-%m-%d').astimezone()
                            days_since_quarter = (datetime.now().astimezone() - latest_quarter_date).days
                            days_since_check = (datetime.now().astimezone() - last_updated).days
                            
                            # If the last reported quarter is less than 90 days ago, no new quarter can possibly exist yet.
                            if days_since_quarter < 90:
                                return cached_data
                            # If it's been > 90 days, new data might be out. Check at most once every 7 days to avoid spamming yfinance.
                            elif days_since_check < 7:
                                return cached_data
            except Exception as e:
                print(f"Cache read error for {symbol}: {e}")

        try:
            ticker = yf.Ticker(symbol)
            financials = ticker.quarterly_financials
            if financials.empty:
                return []
            
            result = []
            # Up to 12 quarters
            for date_col in financials.columns[:12]: 
                q_data = {"date": date_col.strftime('%Y-%m-%d')}
                for idx in financials.index:
                    val = financials.at[idx, date_col]
                    if not pd.isna(val):
                        try:
                            q_data[idx] = float(val)
                        except (ValueError, TypeError):
                            q_data[idx] = val
                result.append(q_data)
                
            if self.supabase and result:
                try:
                    self.supabase.table('financials_cache').upsert({
                        'symbol': symbol,
                        'quarterly_data': result,
                        'last_updated': datetime.now().astimezone().isoformat()
                    }).execute()
                except Exception as e:
                    print(f"Cache write error for {symbol}: {e}")
                    
            return result
        except Exception as e:
            print(f"Error fetching quarterly financials for {symbol}: {e}")
            return []

    def synthesize_decision(self, symbol, position_context, alpha_data, news_data, tech_scores, fundamentals):
        """Feeds all data into Gemini to generate a portfolio decision."""
        
        system_instruction = """
        You are an expert quantitative financial developer and Portfolio Manager.
        Your investment horizon is > 1 year. You do not trade short-term noise.
        You are managing an existing portfolio. 
        You MUST use position-aware logic based on 'total_unrealized_pnl_pct'.
        - If a position is up heavily (e.g., > 40%), suggest trailing stops or partial profit taking (SELL or HOLD) unless the quantitative and macro conviction is exceptionally high.
        - Ignore short-term volatility and rely on long-term macro/technical structures.
        - Analyze the confluence of the deduplicated news, technical score (-1.0 to 1.0, where 1.0 is highly bullish), macro regime (VIX, 10Y Yield), and insider buying.
        
        Output strictly as JSON matching this schema:
        {
            "action": "BUY_MORE" | "HOLD" | "SELL",
            "conviction_score": <int between 1 and 10>,
            "rationale": [
                "bullet point 1 explaining the tech/macro confluence",
                "bullet point 2 explaining the position-aware logic",
                "bullet point 3 on news sentiment"
            ]
        }
        """
        
        prompt = f"""
        Analyze the following data for {symbol} and provide your portfolio decision.
        
        1. Position Context: {json.dumps(position_context)}
        2. Quantitative Technical Scores: {json.dumps(tech_scores)}
        3. Fundamental Data: {json.dumps(fundamentals)}
        4. Alpha Data (Macro, Insider, Drift): {json.dumps(alpha_data)}
        5. Recent News Events: {json.dumps(news_data)}
        """

        try:
            response = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.2 # Low temperature for more deterministic analysis
                )
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"Error generating LLM decision for {symbol}: {e}")
            return {
                "action": "HOLD",
                "conviction_score": 1,
                "rationale": [
                    "AI Analysis failed. Is your GEMINI_API_KEY set correctly?",
                    f"System Error: {str(e)}"
                ]
            }

    def synthesize_macro_analysis(self, symbol, fundamentals):
        """Generates a dedicated Macro & Fundamental analysis for a single stock."""
        system_instruction = """
        You are a seasoned Macroeconomist and Fundamental Analyst.
        Provide a concise but insightful analysis of the stock's macro environment, sector tailwinds, and country-specific risks.
        Evaluate the provided fundamental metrics (e.g. P/E, P/B, Debt/Equity).
        Output strictly as JSON matching this schema:
        {
            "macro_environment": "paragraph about interest rates, inflation, etc. impacting this stock",
            "sector_analysis": "paragraph about the specific sector tailwinds or headwinds",
            "fundamental_health": "paragraph interpreting the P/E, Debt/Equity, etc."
        }
        """
        prompt = f"Analyze {symbol} given these fundamentals: {json.dumps(fundamentals)}"
        try:
            response = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.3
                )
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"Error generating Macro Analysis for {symbol}: {e}")
            return None

    def log_prediction(self, symbol, decision):
        """Logs the decision to Supabase."""
        if not self.supabase or not decision:
            return
            
        try:
            self.supabase.table('prediction_logs').insert({
                'symbol': symbol,
                'prediction_date': datetime.now().date().isoformat(),
                'action': decision.get('action'),
                'conviction_score': decision.get('conviction_score'),
                'rationale': decision.get('rationale')
            }).execute()
        except Exception as e:
            print(f"Error logging prediction to DB for {symbol}: {e}")

    def send_notification(self, symbol, decision):
        """Sends a notification to a Discord webhook."""
        if not self.discord_webhook_url or not decision:
            return
            
        color = 0x00FF00 if decision['action'] == 'BUY_MORE' else 0xFF0000 if decision['action'] == 'SELL' else 0xFFFF00
        
        embed = {
            "title": f"Daily Quant Report: {symbol}",
            "color": color,
            "fields": [
                {"name": "Action", "value": decision['action'], "inline": True},
                {"name": "Conviction", "value": f"{decision['conviction_score']}/10", "inline": True},
                {"name": "Rationale", "value": "\n".join([f"- {r}" for r in decision['rationale']])}
            ],
            "footer": {"text": f"Automated Portfolio Manager | {datetime.now().strftime('%Y-%m-%d')}"}
        }
        
        try:
            requests.post(self.discord_webhook_url, json={"embeds": [embed]})
        except Exception as e:
            print(f"Failed to send Discord notification: {e}")

    def run_synthesis(self, aggregated_data):
        """Main orchestrator for this microservice."""
        print("Starting LLM Synthesis...")
        results = {}
        
        for symbol in aggregated_data.keys():
            context = self.get_position_context(symbol)
            
            # Extract data components passed from previous microservices
            alpha = aggregated_data[symbol].get('alpha')
            news = aggregated_data[symbol].get('news')
            tech = aggregated_data[symbol].get('tech')
            
            fundamentals = self.get_fundamental_data(symbol)
            decision = self.synthesize_decision(symbol, context, alpha, news, tech, fundamentals)
            
            if decision:
                print(f"Decision for {symbol}: {decision['action']} (Conviction: {decision['conviction_score']})")
                self.log_prediction(symbol, decision)
                self.send_notification(symbol, decision)
                results[symbol] = decision
                
        print("LLM Synthesis Complete.")
        return results

    def synthesize_portfolio(self):
        """Analyzes the entire portfolio based on summary data."""
        if not self.supabase:
            return None
            
        try:
            # Fetch all portfolio summary data
            response = self.supabase.table('portfolio_summary').select('*').execute()
            portfolio = response.data
            
            if not portfolio:
                return None
                
            system_instruction = '''
            You are a Chief Investment Officer managing a portfolio.
            Given the user's current portfolio holdings, calculate or estimate the sector and country breakdown.
            Provide a high-level risk assessment and actionable insights.
            CRITICAL RULE: Consider the individual asset predictions provided in the prompt holistically. Weigh them against macroeconomic risks and provide honest, objective, and highly critical portfolio-level advice. Do NOT just be complimentary. Proactively identify concentration risks, overvaluations, and macroeconomic vulnerabilities. Your recommendations should optimize for the best possible outcome given the overall portfolio risk exposure.
            Provide at least 6-8 detailed insights in the rationale list covering macro, fundamentals, and specific asset synergies or risks.
            Output as JSON:
            {
                "risk_level": "LOW" | "MEDIUM" | "HIGH",
                "action": "REBALANCE" | "HOLD" | "DE-RISK",
                "sector_breakdown": {"Technology": 40, "Healthcare": 20, ...},
                "country_breakdown": {"US": 80, "China": 20, ...},
                "sector_assets": {"Technology": ["AAPL", "MSFT"], "Healthcare": ["JNJ"]},
                "country_assets": {"US": ["AAPL", "MSFT", "JNJ"], "China": ["BABA"]},
                "rationale": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5", "insight 6"]
            }
            '''
            
            # Fetch latest predictions and country data
            predictions_res = self.supabase.table('prediction_logs').select('*').order('created_at', desc=True).execute()
            latest_preds = {}
            if predictions_res.data:
                for p in predictions_res.data:
                    if p['symbol'] not in latest_preds:
                        latest_preds[p['symbol']] = p['action']
                        
            # Calculate country and sector breakdown locally to feed AI
            for item in portfolio:
                try:
                    info = yf.Ticker(item['symbol']).info
                    item['country'] = info.get('country', 'Unknown')
                    item['sector'] = info.get('sector', 'Unknown')
                except Exception:
                    item['country'] = 'Unknown'
                    item['sector'] = 'Unknown'
            
            prompt = f"Portfolio Holdings (with sectors and countries):\n{json.dumps(portfolio)}\n\nIndividual Asset Predictions (DO NOT contradict these actions):\n{json.dumps(latest_preds)}"
            
            res = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            analysis = json.loads(res.text)
            
            # Log to DB
            try:
                self.supabase.table('portfolio_analysis_logs').insert({
                    'risk_level': analysis.get('risk_level'),
                    'action': analysis.get('action'),
                    'rationale': analysis.get('rationale'),
                    'sector_breakdown': analysis.get('sector_breakdown'),
                    'country_breakdown': analysis.get('country_breakdown')
                }).execute()
            except Exception as db_err:
                print(f"Warning: Failed to log portfolio analysis to DB: {db_err}")
            
            return analysis
            
        except Exception as e:
            print(f"Error in portfolio synthesis: {e}")
            return {"error": str(e)}

if __name__ == "__main__":
    # Test execution (requires GEMINI_API_KEY to be set in env)
    service = PortfolioManagerService()
    # Provide mock aggregated data to test the LLM inference
    mock_data = {
        'MU': {
            'alpha': {'macro': {'vix': 15.0, 'treasury_10y_yield': 4.1}, 'insider_tracking': {'insider_filings_count': 2}},
            'news': [{'headline': 'Micron reports strong earnings beat on AI demand'}],
            'tech': {'composite_score': 0.7, 'daily_score': 0.8, 'weekly_score': 0.6}
        }
    }
    service.run_synthesis(mock_data)
