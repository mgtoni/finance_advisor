-- Database Schema for Quantitative Financial Advisor Pipeline

-- 1. Tickers Table
CREATE TABLE tickers (
    symbol VARCHAR(15) PRIMARY KEY,
    open_date DATE NOT NULL,
    shares NUMERIC(10, 4) NOT NULL,
    average_entry_price NUMERIC(10, 4) NOT NULL,
    last_close_price NUMERIC(10, 4),
    unrealized_pnl_fiat NUMERIC(10, 4) GENERATED ALWAYS AS ((last_close_price - average_entry_price) * shares) STORED,
    unrealized_pnl_pct NUMERIC(10, 4) GENERATED ALWAYS AS (CASE WHEN average_entry_price > 0 THEN ((last_close_price - average_entry_price) / average_entry_price) * 100 ELSE 0 END) STORED,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. News Events Table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE news_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) REFERENCES tickers(symbol),
    headline TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    source VARCHAR(50),
    published_at TIMESTAMP WITH TIME ZONE,
    sentiment_score NUMERIC(4, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Prediction Logs Table
CREATE TABLE prediction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) REFERENCES tickers(symbol),
    prediction_date DATE DEFAULT CURRENT_DATE,
    action VARCHAR(15) CHECK (action IN ('BUY_MORE', 'HOLD', 'SELL')),
    conviction_score INTEGER CHECK (conviction_score BETWEEN 1 AND 10),
    rationale JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Note: In Supabase, you can run this script in the SQL Editor to create these tables.

-- 4. Row Level Security (RLS)
ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_logs ENABLE ROW LEVEL SECURITY;

-- Allow read access for anon role
CREATE POLICY "Allow public read access for tickers" ON tickers FOR SELECT USING (true);
CREATE POLICY "Allow public read access for news_events" ON news_events FOR SELECT USING (true);
CREATE POLICY "Allow public read access for prediction_logs" ON prediction_logs FOR SELECT USING (true);

-- Allow insert/update access for anon role (for the Python backend)
CREATE POLICY "Allow public insert for tickers" ON tickers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for tickers" ON tickers FOR UPDATE USING (true);

CREATE POLICY "Allow public insert for news_events" ON news_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for news_events" ON news_events FOR UPDATE USING (true);

CREATE POLICY "Allow public insert for prediction_logs" ON prediction_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for prediction_logs" ON prediction_logs FOR UPDATE USING (true);
