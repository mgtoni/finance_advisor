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
            # Tier 1
            'Wall Street Journal': 1, 'Financial Times': 1, 'Bloomberg': 1,
            'Barron\'s': 1, 'Reuters': 1, 'The Economist': 1, 'Handelsblatt': 1,
            'Les Echos': 1, 'Il Sole 24 Ore': 1, 'International Financing Review': 1,
            'Benzinga': 1,

            # Tier 2
            'Institutional Investor': 2, 'The Information': 2, 'Risk.net': 2,
            'American Banker': 2, 'Private Equity International': 2, 'The Deal': 2,
            'PitchBook': 2, 'S&P Global': 2, 'Financial News': 2, 'Börsen-Zeitung': 2,
            'Expansión': 2, 'Cinco Días': 2, 'Dagens Industri': 2, 'De Tijd': 2,
            'L\'Echo': 2, 'Fortune': 2, 'Forbes': 2, 'Yahoo Finance': 2, 'MarketWatch': 2,

            # Tier 3
            'Investor\'s Business Daily': 3, 'Seeking Alpha': 3, 'Investopedia': 3,
            'Motley Fool': 3, 'Business Insider': 3, 'Zacks': 3, 'Kiplinger': 3,
            'TheStreet': 3, 'City A.M.': 3, 'MoneyWeek': 3, 'Finanzen.net': 3,
            'Boursorama': 3, 'Finansavisen': 3
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
        
        # Initialize defaults for ALL articles so we never insert NULLs
        for article in articles:
            article['sentiment_score'] = 0.0
            article['impact_summary'] = 'Pending AI analysis.'

        # Process in chunks of 15 to prevent the LLM from losing count or truncating output
        chunk_size = 15
        for i in range(0, len(articles), chunk_size):
            chunk = articles[i:i + chunk_size]
            prompt = f"Symbol: {symbol}\nArticles:\n"
            for j, article in enumerate(chunk):
                prompt += f"{j+1}. Headline: {article['headline']} (Source: {article['source']}, Tier: {article.get('source_tier', 3)})\n"
                
            try:
                response = self.model.generate_content(
                    contents=[system_instruction, prompt],
                    generation_config=genai.GenerationConfig(
                        response_mime_type="application/json",
                        temperature=0.1
                    )
                )
                import json
                analysis = json.loads(response.text)
                
                for j, article in enumerate(chunk):
                    if j < len(analysis):
                        article['sentiment_score'] = analysis[j].get('sentiment_score', 0.0)
                        article['impact_summary'] = analysis[j].get('impact_summary', 'Pending AI analysis.')
                        
            except Exception as e:
                print(f"Error generating sentiment for {symbol} (chunk {i}): {e}")
                
        return articles

    def fetch_alpaca_news_bulk(self, tickers):
        """Fetches news from Alpaca REST API for all tickers in one bulk request."""
        import requests
        articles_by_symbol = {t: [] for t in tickers}
        alpaca_key = os.getenv("ALPACA_API_KEY")
        alpaca_secret = os.getenv("ALPACA_SECRET_KEY")
        
        if not alpaca_key or not alpaca_secret:
            print("Alpaca API keys missing. Cannot fetch news.")
            return articles_by_symbol

        try:
            url = f"https://data.alpaca.markets/v1beta1/news?symbols={','.join(tickers)}&limit=50"
            headers = {
                "APCA-API-KEY-ID": alpaca_key,
                "APCA-API-SECRET-KEY": alpaca_secret
            }
            res = requests.get(url, headers=headers)
            if res.status_code == 200:
                news_items = res.json().get('news', [])
                for item in news_items:
                    article_obj = {
                        'headline': item.get('headline', ''),
                        'url': item.get('url', ''),
                        'source': item.get('source', 'Benzinga/Alpaca'),
                        'published_at': item.get('created_at', datetime.now().isoformat())
                    }
                    for sym in item.get('symbols', []):
                        if sym in articles_by_symbol:
                            articles_by_symbol[sym].append({**article_obj, 'symbol': sym})
            else:
                print(f"Alpaca API error: {res.status_code} - {res.text}")
        except Exception as e:
            print(f"Error fetching Alpaca news: {e}")
            
        return articles_by_symbol

    def fetch_yahoo_news(self, symbol):
        """Fetches news from Yahoo Finance backdoor, supporting both legacy and modern yfinance schemas."""
        articles = []
        try:
            ticker = yf.Ticker(symbol)
            news = ticker.news
            if not news:
                return []
            for item in news:
                if not isinstance(item, dict):
                    continue
                content = item.get('content', {}) if isinstance(item.get('content'), dict) else {}
                title = content.get('title') or item.get('title') or ''
                if not title:
                    continue
                url = (content.get('canonicalUrl') or {}).get('url') if isinstance(content.get('canonicalUrl'), dict) else item.get('link', '')
                source = (content.get('provider') or {}).get('displayName') if isinstance(content.get('provider'), dict) else item.get('publisher', 'Yahoo Finance')
                
                articles.append({
                    'symbol': symbol,
                    'headline': title,
                    'url': url or f"https://finance.yahoo.com/quote/{symbol}",
                    'source': source or 'Yahoo Finance',
                    'source_tier': self.assign_tier(source or 'Yahoo Finance'),
                    'published_at': content.get('pubDate') or datetime.now().isoformat()
                })
        except Exception as e:
            print(f"Error fetching Yahoo news for {symbol}: {e}")
        return articles




    def fetch_alternative_sentiment(self, symbol):
        """Fetches alternative retail sentiment from Reddit and StockTwits using DuckDuckGo."""
        articles = []
        try:
            with DDGS() as ddgs:
                results = ddgs.text(keywords=f"(site:reddit.com/r/wallstreetbets OR site:reddit.com/r/stocks OR site:stocktwits.com) {symbol} stock", max_results=5)
                for item in results:
                    articles.append({
                        'symbol': symbol,
                        'headline': f"[Retail Sentiment] {item.get('title', '')}",
                        'url': item.get('href', ''),
                        'source': 'Reddit/Retail',
                        'published_at': datetime.now().isoformat()
                    })
        except Exception as e:
            print(f"Error fetching alt sentiment for {symbol}: {e}")
        return articles

    def scrape_stocktwits_metrics(self, symbol):
        """Scrapes Stocktwits for Sentiment and Message Volume gauges."""
        import requests
        from bs4 import BeautifulSoup
        import re, json
        
        metrics = {'sentiment': None, 'volume': None}
        url = f'https://stocktwits.com/symbol/{symbol}/sentiment'
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code == 200:
                # Look for Next.js data blobs
                blobs = re.findall(r'<script[^>]*>(.*?)</script>', res.text)
                for blob in blobs:
                    if len(blob) > 100000 and '"initialSentimentCardData"' in blob:
                        try:
                            data = json.loads(blob)
                            initial = data['props']['pageProps'].get('initialData', {})
                            sentiment_card = initial.get('initialSentimentCardData', {})
                            
                            # Extract sentiment
                            if 'sentiment' in sentiment_card and len(sentiment_card['sentiment']) > 0:
                                metrics['sentiment'] = int(sentiment_card['sentiment'][0]['value'])
                                
                            # Extract message volume
                            if 'messageVol' in sentiment_card and len(sentiment_card['messageVol']) > 0:
                                metrics['volume'] = int(sentiment_card['messageVol'][0]['value'])
                            break
                        except Exception as e:
                            print(f"Error parsing Stocktwits JSON blob for {symbol}: {e}")
        except Exception as e:
            print(f"Error scraping StockTwits metrics for {symbol}: {e}")
            
        return metrics

    def fetch_retail_sentiment_data(self, symbol):
        """Fetches Reddit/StockTwits mentions over the last 30 days using DuckDuckGo."""
        articles = []
        try:
            with DDGS() as ddgs:
                # timelimit='m' translates to last month (approx 30 days)
                results = ddgs.news(keywords=f"{symbol} stock retail sentiment", max_results=15, timelimit='m')
                for item in results:
                    articles.append({
                        'symbol': symbol,
                        'headline': f"[Retail Sentiment] {item.get('title', '')}",
                        'url': item.get('url', ''),
                        'source': item.get('source', 'Web/Retail'),
                        'body': item.get('body', ''),
                        'published_at': item.get('date', datetime.now().isoformat())
                    })
        except Exception as e:
            print(f"Error fetching retail sentiment data for {symbol}: {e}")
                
        return articles

    def generate_social_ai_summary(self, symbol, mentions):
        """Uses Gemini to synthesize an AI summary of retail sentiment."""
        if not mentions:
            return "No significant retail mentions found for the last 30 days."
            
        system_instruction = '''
        You are an expert quantitative sentiment analyst specializing in retail trading forums.
        Given a list of recent mentions of a stock on platforms like r/WallStreetBets, r/stocks, and Stocktwits,
        provide a 2-3 sentence summary of the retail sentiment. 
        Focus on:
        1. The overall sentiment (highly bullish, bearish, mixed).
        2. How retail commenters interpret the asset's performance.
        3. Mentions of broader market trends if any.
        '''
        
        prompt = f"Symbol: {symbol}\nRecent Mentions (Last 30 Days):\n"
        for i, m in enumerate(mentions[:10]): # limit to top 10 for summary
            prompt += f"- {m['headline']}: {m.get('body', '')}\n"
            
        try:
            response = self.model.generate_content(
                contents=[system_instruction, prompt],
                generation_config=genai.GenerationConfig(
                    temperature=0.3
                )
            )
            return response.text.strip()
        except Exception as e:
            print(f"Error generating social AI summary for {symbol}: {e}")
            return "Sentiment analysis unavailable at this time."

    def fetch_earnings_transcript_summaries(self, symbol):
        """Fetches recent earnings call transcript summaries via DuckDuckGo."""
        articles = []
        try:
            with DDGS() as ddgs:
                results = ddgs.news(keywords=f"{symbol} earnings call transcript summary", max_results=2)
                for item in results:
                    articles.append({
                        'symbol': symbol,
                        'headline': f"[Earnings Call] {item.get('title', '')}",
                        'url': item.get('url', ''),
                        'source': item.get('source', 'DuckDuckGo Earnings'),
                        'published_at': item.get('date', datetime.now().isoformat())
                    })
        except Exception as e:
            print(f"Error fetching earnings transcripts for {symbol}: {e}")
        return articles

    def aggregate_and_deduplicate(self, symbol, base_articles):
        """Runs parallel scrapes for alternative data and deduplicates with base Alpaca articles."""
        all_articles = list(base_articles)
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_earnings = executor.submit(self.fetch_earnings_transcript_summaries, symbol)
            
            if len(base_articles) == 0:
                future_yahoo = executor.submit(self.fetch_yahoo_news, symbol)
                all_articles.extend(future_yahoo.result())
                
            all_articles.extend(future_earnings.result())
            
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
        
        # 1. Fetch bulk Alpaca News for all tickers at once
        alpaca_news_by_symbol = self.fetch_alpaca_news_bulk(tickers)
        
        for symbol in tickers:
            base_articles = alpaca_news_by_symbol.get(symbol, [])
            articles = self.aggregate_and_deduplicate(symbol, base_articles)
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
