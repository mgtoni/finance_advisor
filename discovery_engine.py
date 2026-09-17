import os
import json
import google.generativeai as genai
import yfinance as yf
from quant_engine import QuantEngineService
from portfolio_manager import PortfolioManagerService

class DiscoveryEngineService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        self.model = genai.GenerativeModel('gemini-3.8-flash')
        self.quant_svc = QuantEngineService()
        self.portfolio_svc = PortfolioManagerService(supabase_client=self.supabase)

    def analyze_gaps(self):
        """Analyzes the portfolio to find missing sectors/countries."""
        analysis = self.portfolio_svc.synthesize_portfolio()
        if not analysis:
            return None
        return analysis

    def run_discovery(self):
        print("Starting AI Discovery Engine...")
        
        # 1. Get Portfolio Gaps
        portfolio_analysis = self.analyze_gaps()
        if not portfolio_analysis:
            print("No portfolio data to analyze. Skipping discovery.")
            return []

        # 2. Ask AI to suggest 5 tickers to fill the gaps
        system_instruction = '''
        You are a quantitative stock screener. 
        Given a portfolio analysis that highlights concentration risks and macro gaps, 
        your job is to suggest exactly 5 ticker symbols (US or International available on Yahoo Finance) 
        that perfectly balance the portfolio, reduce its correlation risk, and offer strong upside.
        
        Return ONLY a JSON array of strings containing the 5 ticker symbols.
        Example: ["NVO", "ASML", "BA", "RIO", "JPM"]
        '''
        
        prompt = f"Portfolio Analysis:\n{json.dumps(portfolio_analysis)}"
        
        candidates = []
        try:
            res = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.4
                )
            )
            candidates = json.loads(res.text)
            print(f"AI suggested candidates to fill gaps: {candidates}")
        except Exception as e:
            print(f"Error generating discovery candidates: {e}")
            return []

        # 3. Run candidates through Quant Engine
        print("Running candidates through Quant Engine...")
        quant_results = self.quant_svc.run_quant_engine(candidates)
        
        # 4. Rank candidates by Composite Score
        ranked_candidates = []
        for symbol, scores in quant_results.items():
            if scores and 'composite_score' in scores:
                ranked_candidates.append({
                    'symbol': symbol,
                    'score': scores['composite_score'],
                    'details': scores
                })
        
        ranked_candidates.sort(key=lambda x: x['score'], reverse=True)
        top_3 = ranked_candidates[:3]
        
        # 5. Generate final thesis for the top 3
        print(f"Top 3 Draft Picks selected: {[c['symbol'] for c in top_3]}")
        draft_picks = []
        
        thesis_instruction = '''
        You are a Portfolio Manager. For the suggested stock, explain WHY it is a good addition to the user's portfolio.
        Mention how it balances the macro risks and fills sector/country gaps identified previously.
        Keep it to 2-3 concise bullet points.
        Output as a JSON object: {"thesis": ["point 1", "point 2"]}
        '''
        
        for pick in top_3:
            symbol = pick['symbol']
            try:
                info = yf.Ticker(symbol).info
                company_name = info.get('longName', symbol)
                sector = info.get('sector', 'Unknown')
                
                thesis_prompt = f"Stock: {symbol} ({company_name}, {sector})\nQuant Score: {pick['score']}\nOriginal Portfolio Gaps: {json.dumps(portfolio_analysis)}"
                
                res = self.model.generate_content(
                    contents=[thesis_instruction, thesis_prompt],
                    generation_config=genai.GenerationConfig(
                        response_mime_type="application/json",
                        temperature=0.2
                    )
                )
                thesis_data = json.loads(res.text)
                
                pick['company_name'] = company_name
                pick['sector'] = sector
                pick['thesis'] = thesis_data.get('thesis', [])
                draft_picks.append(pick)
                
            except Exception as e:
                print(f"Error generating thesis for {symbol}: {e}")
                
        # 6. Save Draft Picks to DB
        if self.supabase and draft_picks:
            try:
                # Try to insert into discovery_picks if the table exists
                for pick in draft_picks:
                    self.supabase.table('discovery_picks').insert({
                        'symbol': pick['symbol'],
                        'company_name': pick['company_name'],
                        'sector': pick['sector'],
                        'quant_score': pick['score'],
                        'thesis': pick['thesis']
                    }).execute()
            except Exception as e:
                print(f"Could not save draft picks to DB (Ensure 'discovery_picks' table exists): {e}")
                
        print("Discovery Engine Complete.")
        return draft_picks

if __name__ == "__main__":
    # For testing, we need to mock the Supabase client or rely on the `.env` configuration.
    from main import get_supabase_client
    service = DiscoveryEngineService(supabase_client=get_supabase_client())
    results = service.run_discovery()
    import pprint
    pprint.pprint(results)
