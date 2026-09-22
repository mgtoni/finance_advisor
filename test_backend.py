
import os
import sys
from server import app
from news_aggregator import NewsAggregatorService

service = NewsAggregatorService()
print('Testing stocktwits metrics for AAPL...')
metrics = service.scrape_stocktwits_metrics('AAPL')
print('Metrics:', metrics)

print('Testing retail sentiment for AAPL...')
mentions = service.fetch_retail_sentiment_data('AAPL')
print(f'Found {len(mentions)} mentions')

print('Testing AI summary for AAPL...')
summary = service.generate_social_ai_summary('AAPL', mentions)
print('Summary:', summary)

