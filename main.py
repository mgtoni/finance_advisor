import os
from dotenv import load_dotenv
from supabase import create_client, Client

from data_ingestion import DataIngestionService
from news_aggregator import NewsAggregatorService
from quant_engine import QuantEngineService
from portfolio_manager import PortfolioManagerService

load_dotenv()

def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if url and key:
        return create_client(url, key)
    print("Warning: SUPABASE_URL or SUPABASE_KEY not found. Running in local/mock mode.")
    return None

def main():
    print("=== Starting Quantitative Financial Pipeline ===")
    
    # 1. Initialization
    supabase = get_supabase_client()
    test_universe = ['MU', 'WDC']
    
    # Initialize microservices
    ingestion_svc = DataIngestionService(supabase_client=supabase)
    news_svc = NewsAggregatorService(supabase_client=supabase)
    quant_svc = QuantEngineService()
    portfolio_svc = PortfolioManagerService(supabase_client=supabase)
    
    aggregated_data = {symbol: {} for symbol in test_universe}
    
    # 2. Run Data Ingestion (Microservice 1)
    print("\n--- Microservice 1: Data Ingestion ---")
    ingestion_results = ingestion_svc.run_ingestion(test_universe)
    for symbol in test_universe:
        aggregated_data[symbol]['alpha'] = {
            'macro': ingestion_results['macro'],
            'insider_tracking': ingestion_results['alpha'][symbol]['insider_tracking'],
            'earnings_drift': ingestion_results['alpha'][symbol]['earnings_drift']
        }
    
    # 3. Run News Aggregation (Microservice 2)
    print("\n--- Microservice 2: News Aggregation ---")
    news_results = news_svc.run_aggregation(test_universe)
    for symbol in test_universe:
        aggregated_data[symbol]['news'] = news_results.get(symbol, [])
        
    # 4. Run Quant Engine (Microservice 3)
    print("\n--- Microservice 3: Quantitative Engine ---")
    quant_results = quant_svc.run_quant_engine(test_universe)
    for symbol in test_universe:
        aggregated_data[symbol]['tech'] = quant_results.get(symbol, {})
        
    # 5. Run LLM Synthesis & Portfolio Management (Microservice 4)
    print("\n--- Microservice 4: LLM Synthesis ---")
    final_decisions = portfolio_svc.run_synthesis(aggregated_data)
    
    print("\n=== Pipeline Execution Complete ===")

if __name__ == "__main__":
    main()
