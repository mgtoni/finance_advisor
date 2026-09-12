import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StockChart from './StockChart';
import { Activity, TrendingUp, TrendingDown, BookOpen } from 'lucide-react';

const Dashboard = () => {
  const [tickers, setTickers] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    fetchTickers();
  }, []);

  useEffect(() => {
    if (selectedTicker) {
      fetchTickerData(selectedTicker.symbol);
    }
  }, [selectedTicker]);

  const fetchTickers = async () => {
    try {
      const { data, error } = await supabase
        .from('portfolio_summary')
        .select('*')
        .order('symbol');
      
      if (error) throw error;
      
      setTickers(data || []);
      if (data && data.length > 0 && !selectedTicker) {
        setSelectedTicker(data[0]);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching tickers:', error);
      setFetchError(error.message);
      setLoading(false);
    }
  };

  const fetchTickerData = async (symbol) => {
    try {
      // Fetch latest prediction
      const { data: predData, error: predError } = await supabase
        .from('prediction_logs')
        .select('*')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1);

      if (predError) throw predError;
      setPrediction(predData && predData.length > 0 ? predData[0] : null);

      // Fetch recent news
      const { data: newsData, error: newsError } = await supabase
        .from('news_events')
        .select('*')
        .eq('symbol', symbol)
        .order('published_at', { ascending: false })
        .limit(5);

      if (newsError) throw newsError;
      setNews(newsData || []);

    } catch (error) {
      console.error('Error fetching ticker details:', error);
    }
  };

  if (loading) return <div className="spinner"></div>;
  if (fetchError) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-red)' }}>Error loading dashboard: {fetchError}</div>;
  if (tickers.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <h2>Welcome to Quant Advisor</h2>
        <p style={{ marginTop: '1rem' }}>Your portfolio is currently empty.</p>
        <p>Please go to the <strong>Manage</strong> tab to add your first holding and run the AI analysis.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      {/* Sidebar: Portfolio Overview */}
      <aside className="glass-panel">
        <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={20} color="var(--accent-blue)" /> 
          Portfolio
        </h2>
        
        <div className="ticker-list">
          {tickers.map(t => {
            const isActive = selectedTicker?.symbol === t.symbol;
            const isPositive = t.total_unrealized_pnl_pct >= 0;
            
            return (
              <div 
                key={t.symbol}
                className={`glass-panel ticker-card ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedTicker(t)}
                style={{ padding: '1rem' }}
              >
                <div>
                  <div className="ticker-symbol">{t.symbol}</div>
                  <div className="ticker-shares">{t.total_shares} Shares</div>
                </div>
                <div className="pnl-value">
                  <div style={{ fontSize: '1.1rem' }}>${t.last_close_price?.toFixed(2) || '---'}</div>
                  <div className={isPositive ? 'pnl-positive' : 'pnl-negative'}>
                    {isPositive ? '+' : ''}{t.total_unrealized_pnl_pct?.toFixed(2) || '0.00'}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Content: Deep Dive */}
      <section className="main-content">
        {selectedTicker && (
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2>{selectedTicker.symbol} Overview</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Avg Entry: ${selectedTicker.average_entry_price?.toFixed(2)} | 
                  Total Shares: {selectedTicker.total_shares}
                </p>
              </div>
              {prediction && (
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge badge-${prediction.action.toLowerCase().replace('_more', '')}`}>
                    {prediction.action.replace('_', ' ')}
                  </span>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Conviction: {prediction.conviction_score}/10
                  </div>
                </div>
              )}
            </div>

            <StockChart symbol={selectedTicker.symbol} />

            {prediction && (
              <div className="ai-summary glass-panel" style={{ marginTop: '2rem', background: 'rgba(59, 130, 246, 0.03)' }}>
                <h3>AI Synthesis & Rationale</h3>
                <ul className="rationale-list">
                  {prediction.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1rem', textAlign: 'right' }}>
                  Last updated: {new Date(prediction.created_at).toLocaleString()}
                </div>
              </div>
            )}

            {news.length > 0 && (
              <div style={{ marginTop: '2rem' }}>
                <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                  <BookOpen size={18} /> Recent News Flow
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {news.map(n => (
                    <a 
                      key={n.id} 
                      href={n.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <h4 style={{ fontSize: '1rem', fontWeight: 500 }}>{n.headline}</h4>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <span>{n.source}</span>
                          <span>{new Date(n.published_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
