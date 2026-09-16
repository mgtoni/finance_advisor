import concurrent.futures
import feedparser
import yfinance as yf
from duckduckgo_search import DDGS
from thefuzz import fuzz
from datetime import datetime
import urllib.parse
import os
import json
import google.generativeai as genai

class NewsAggregatorService:
    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        self.model = genai.GenerativeModel('gemini-3.8-flash')
        
        self.SOURCE_TIERS = {
            'Financial Times': 1, 'Bloomberg': 1, 'Wall Street Journal': 1, 'Reuters': 1,
            'Yahoo Finance': 2, 'CNBC': 2, 'MarketWatch': 2, 'Barron\'s': 2,
            'Seeking Alpha': 3, 'Motley Fool': 3, 'Zacks': 3
        }

    def assign_tier(self, source):
        for key, tier in self.SOURCE_TIERS.items():
            if key.lower() in source.lower():
                return tier
        return 3

    def analyze_sentiment(self, symbol, articles):
        """Uses Gemini to assign a sentiment score and impact summary for each article."""
        if not articles:
            return articles
            
        system_instruction = '''
        You are a quantitative financial analyst. 
        Given a list of news articles for a stock symbol, analyze each article's headline and source.
        IMPORTANT: Sources are categorized by Trust Tiers (1 to 3). You MUST heavily weight Tier 1 sources (Traditional Financial Media like FT, WSJ, Bloomberg) and discount Tier 3 sources (Blogs, random websites).
        Return a JSON array of objects, one for each article in the exact same order.
        Each object must have:
        - "sentiment_score": a float between -1.0 (highly negative) and 1.0 (highly positive).
        - "impact_summary": a 1-sentence summary of how this news might impact the stock price today.
        '''
        
        prompt = f"Symbol: {symbol}\nArticles:\n"
        for i, article in enumerate(articles):
            prompt += f"{i+1}. Headline: {article['headline']} (Source: {article['source']}, Tier: {article.get('source_tier', 3)})\n"
            
        try:
            response = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            analysis = json.loads(response.text)
            
            for i, article in enumerate(articles):
                if i < len(analysis):
                    article['sentiment_score'] = analysis[i].get('sentiment_score', 0)
                    article['impact_summary'] = analysis[i].get('impact_summary', '')
                    
        except Exception as e:
            print(f"Error generating sentiment for {symbol}: {e}")
            
        return articles

    def fetch_yahoo_news(self, symbol):
        """Fetches news from Yahoo Finance backdoor."""
        articles = []
        try:
            ticker = yf.Ticker(symbol)
            news = ticker.news
            for item in news:
                articles.append({
                    'symbol': symbol,
                    'headline': item.get('title', ''),
                    'url': item.get('link', ''),
                    'source': item.get('publisher', 'Yahoo Finance'),
                    'published_at': datetime.fromtimestamp(item.get('providerPublishTime', 0)).isoformat() if item.get('providerPublishTime') else datetime.now().isoformat()
                })
        except Exception as e:
            print(f"Error fetching Yahoo news for {symbol}: {e}")
        return articles

    def fetch_duckduckgo_news(self, symbol):
        """Fetches news via DuckDuckGo."""
        articles = []
        try:
            with DDGS() as ddgs:
                results = ddgs.news(keywords=symbol, max_results=5)
                for item in results:
                    articles.append({
                        'symbol': symbol,
                        'headline': item.get('title', ''),
                        'url': item.get('url', ''),
                        'source': item.get('source', 'DuckDuckGo'),
                        'published_at': item.get('date', datetime.now().isoformat())
                    })
        except Exception as e:
            print(f"Error fetching DDG news for {symbol}: {e}")
        return articles

    def fetch_google_news_rss(self, symbol):
        """Fetches news from Google News RSS for the last 24 hours."""
        articles = []
        try:
            # We add 'stock' to help disambiguate tickers like MU or WDC
            query = urllib.parse.quote(f"{symbol} stock when:1d")
            rss_url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:  # Limit to top 5 recent to avoid noise
                articles.append({
                    'symbol': symbol,
                    'headline': entry.title,
                    'url': entry.link,
                    'source': entry.source.title if hasattr(entry, 'source') else 'Google News RSS',
                    'published_at': entry.published if hasattr(entry, 'published') else datetime.now().isoformat()
                })
        except Exception as e:
            print(f"Error fetching Google RSS news for {symbol}: {e}")
        return articles

    def aggregate_and_deduplicate(self, symbol):
        """Runs parallel scrapes and deduplicates the results."""
        all_articles = []
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_yahoo = executor.submit(self.fetch_yahoo_news, symbol)
            future_ddg = executor.submit(self.fetch_duckduckgo_news, symbol)
            future_google = executor.submit(self.fetch_google_news_rss, symbol)
            
            all_articles.extend(future_yahoo.result())
            all_articles.extend(future_ddg.result())
            all_articles.extend(future_google.result())
            
        # Deduplication Logic
        deduped = []
        seen_urls = set()
        
        for article in all_articles:
            if not article['url'] or not article['headline']:
                continue
                
            if article['url'] in seen_urls:
                continue
                
            # Fuzzy match headlines to catch syndicated articles with different URLs
            is_duplicate = False
            for existing in deduped:
                similarity = fuzz.token_sort_ratio(article['headline'], existing['headline'])
                if similarity > 85: # 85% similarity threshold
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                article['source_tier'] = self.assign_tier(article['source'])
                deduped.append(article)
                seen_urls.add(article['url'])
                
        return deduped

    def run_aggregation(self, tickers):
        print("Starting News Aggregation...")
        results = {}
        for symbol in tickers:
            articles = self.aggregate_and_deduplicate(symbol)
            articles = self.analyze_sentiment(symbol, articles)
            results[symbol] = articles
            
            # Optionally insert into Supabase here
            if self.supabase and articles:
                try:
                    # Supabase `upsert` based on URL being UNIQUE to prevent DB errors
                    self.supabase.table('news_events').upsert(
                        articles, on_conflict='url'
                    ).execute()
                    print(f"Inserted {len(articles)} news items for {symbol} to DB.")
                except Exception as e:
                    print(f"Failed to insert news for {symbol} to Supabase: {e}")
                    
        print("News Aggregation Complete.")
        return results

if __name__ == "__main__":
    # Test execution
    test_tickers = ['MU', 'WDC']
    service = NewsAggregatorService()
    news_data = service.run_aggregation(test_tickers)
    for t, news in news_data.items():
        print(f"\n{t}: {len(news)} articles found")
        for n in news:
            print(f"  - {n['headline']} ({n['source']})")
