-- Database Schema for Quantitative Financial Advisor Pipeline

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create the new positions table first
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) REFERENCES tickers(symbol) ON DELETE CASCADE,
    open_date DATE NOT NULL,
    shares NUMERIC(10, 4) NOT NULL,
    entry_price NUMERIC(10, 4) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Note: If you want to migrate existing data, run this command manually BEFORE running the ALTER TABLE commands below:
-- INSERT INTO positions (symbol, open_date, shares, entry_price) SELECT symbol, open_date, shares, average_entry_price FROM tickers;

-- 2. Alter the existing tickers table (Master list of assets and market data)
-- First, drop the generated columns that depend on the columns we are about to remove
ALTER TABLE tickers DROP COLUMN IF EXISTS unrealized_pnl_fiat;
ALTER TABLE tickers DROP COLUMN IF EXISTS unrealized_pnl_pct;

-- Then, drop the old columns
ALTER TABLE tickers DROP COLUMN IF EXISTS open_date;
ALTER TABLE tickers DROP COLUMN IF EXISTS shares;
ALTER TABLE tickers DROP COLUMN IF EXISTS average_entry_price;

-- 3. Portfolio Summary View (Aggregated metrics)
CREATE OR REPLACE VIEW portfolio_summary AS
SELECT 
    p.symbol,
    SUM(p.shares) AS total_shares,
    SUM(p.shares * p.entry_price) / SUM(p.shares) AS average_entry_price,
    t.last_close_price,
    SUM((t.last_close_price - p.entry_price) * p.shares) AS total_unrealized_pnl_fiat,
    CASE 
        WHEN SUM(p.shares * p.entry_price) > 0 
        THEN (SUM((t.last_close_price - p.entry_price) * p.shares) / SUM(p.shares * p.entry_price)) * 100 
        ELSE 0 
    END AS total_unrealized_pnl_pct
FROM positions p
JOIN tickers t ON p.symbol = t.symbol
GROUP BY p.symbol, t.last_close_price;

-- 4. News Events Table
CREATE TABLE IF NOT EXISTS news_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) REFERENCES tickers(symbol),
    headline TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    source VARCHAR(50),
    source_tier VARCHAR(15),
    published_at TIMESTAMP WITH TIME ZONE,
    sentiment_score NUMERIC(4, 2),
    impact_summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. Prediction Logs Table
CREATE TABLE IF NOT EXISTS prediction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) REFERENCES tickers(symbol),
    prediction_date DATE DEFAULT CURRENT_DATE,
    action VARCHAR(15) CHECK (action IN ('BUY_MORE', 'HOLD', 'SELL')),
    conviction_score INTEGER CHECK (conviction_score BETWEEN 1 AND 10),
    rationale JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5.b. Portfolio Analysis Logs Table
CREATE TABLE IF NOT EXISTS portfolio_analysis_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_date DATE DEFAULT CURRENT_DATE,
    risk_level VARCHAR(15),
    action VARCHAR(15),
    rationale JSONB NOT NULL,
    sector_breakdown JSONB,
    country_breakdown JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. Row Level Security (RLS)
ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_analysis_logs ENABLE ROW LEVEL SECURITY;

-- Allow read access for anon role
CREATE POLICY "Allow public read access for tickers" ON tickers FOR SELECT USING (true);
CREATE POLICY "Allow public read access for positions" ON positions FOR SELECT USING (true);
CREATE POLICY "Allow public read access for news_events" ON news_events FOR SELECT USING (true);
CREATE POLICY "Allow public read access for prediction_logs" ON prediction_logs FOR SELECT USING (true);
CREATE POLICY "Allow public read access for portfolio_analysis_logs" ON portfolio_analysis_logs FOR SELECT USING (true);

-- Allow insert/update access for anon role (for the Python backend)
CREATE POLICY "Allow public insert for tickers" ON tickers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for tickers" ON tickers FOR UPDATE USING (true);

CREATE POLICY "Allow public insert for positions" ON positions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for positions" ON positions FOR UPDATE USING (true);
CREATE POLICY "Allow public delete for positions" ON positions FOR DELETE USING (true);

CREATE POLICY "Allow public insert for news_events" ON news_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for news_events" ON news_events FOR UPDATE USING (true);

CREATE POLICY "Allow public insert for prediction_logs" ON prediction_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for prediction_logs" ON prediction_logs FOR UPDATE USING (true);

CREATE POLICY "Allow public insert for portfolio_analysis_logs" ON portfolio_analysis_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for portfolio_analysis_logs" ON portfolio_analysis_logs FOR UPDATE USING (true);

-- 7. Financials Cache Table
CREATE TABLE IF NOT EXISTS financials_cache (
    symbol VARCHAR(15) PRIMARY KEY,
    quarterly_data JSONB NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE financials_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access for financials_cache" ON financials_cache FOR SELECT USING (true);
CREATE POLICY "Allow public insert for financials_cache" ON financials_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for financials_cache" ON financials_cache FOR UPDATE USING (true);

-- 8. Discovery Picks Table
CREATE TABLE IF NOT EXISTS discovery_picks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(15) NOT NULL,
    company_name VARCHAR(100),
    sector VARCHAR(50),
    quant_score NUMERIC(5, 2),
    thesis JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE discovery_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access for discovery_picks" ON discovery_picks FOR SELECT USING (true);
CREATE POLICY "Allow public insert for discovery_picks" ON discovery_picks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for discovery_picks" ON discovery_picks FOR UPDATE USING (true);
