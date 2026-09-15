import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StockChart from './StockChart';
import Modal from './Modal';
import { Activity, BookOpen, TrendingUp, TrendingDown } from 'lucide-react';

const Dashboard = () => {
  const [tickers, setTickers] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // 1. Fetch Tickers (Portfolio)
      const { data: tickerData, error: tickerError } = await supabase
        .from('portfolio_summary')
        .select('*')
        .order('symbol');
      
      if (tickerError) throw tickerError;
      setTickers(tickerData || []);

      // 2. Fetch Latest Predictions for all tickers to populate the table column
      if (tickerData && tickerData.length > 0) {
        const symbols = tickerData.map(t => t.symbol);
        
        // Since we want the *latest* for each, we can fetch all recent and group,
        // or just fetch them individually if the list isn't huge.
        // For simplicity and to ensure we get the latest, we will fetch for each symbol.
        const preds = {};
        for (const sym of symbols) {
          const { data: predData } = await supabase
            .from('prediction_logs')
            .select('*')
            .eq('symbol', sym)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (predData && predData.length > 0) {
            preds[sym] = predData[0];
          }
        }
        setPredictions(preds);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setFetchError(error.message);
      setLoading(false);
    }
  };

  const handleRowClick = async (ticker) => {
    setSelectedTicker(ticker);
    setSelectedPrediction(predictions[ticker.symbol] || null);
    setIsModalOpen(true);
    
    // Fetch recent news for the selected ticker
    try {
      const { data: newsData, error: newsError } = await supabase
        .from('news_events')
        .select('*')
        .eq('symbol', ticker.symbol)
        .order('published_at', { ascending: false })
        .limit(5);

      if (!newsError) {
        setNews(newsData || []);
      }
    } catch (err) {
      console.error('Error fetching news:', err);
    }
  };

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState({ type: '', message: '' });

  const handleRunAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisStatus({ type: '', message: '' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/run-analysis`, {
        method: 'POST'
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Analysis failed');
      
      setAnalysisStatus({ type: 'success', message: 'Analysis complete! Refreshing data...' });
      await fetchDashboardData();
      
      // Auto-hide success message
      setTimeout(() => setAnalysisStatus({ type: '', message: '' }), 3000);
    } catch (err) {
      console.error(err);
      setAnalysisStatus({ type: 'error', message: err.message || 'Failed to trigger backend.' });
    } finally {
      setAnalysisLoading(false);
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
    <div className="dashboard-container">
      <div className="glass-panel" style={{ padding: '1rem' }}>
        <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '1rem' }}>
          <Activity size={20} color="var(--accent-blue)" /> 
          Portfolio Performance
        </h2>
        
        <div className="table-responsive">
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Price</th>
                <th>Units</th>
                <th>Avg. Open</th>
                <th>P/L</th>
                <th>P/L(%)</th>
                <th>Net Value</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map(t => {
                const isPositive = t.total_unrealized_pnl_pct >= 0;
                const pnlValue = t.total_unrealized_pnl_value || 0;
                const netValue = (t.total_shares * t.last_close_price) || 0;
                const pred = predictions[t.symbol];
                
                return (
                  <tr key={t.symbol} onClick={() => handleRowClick(t)}>
                    <td>
                      <div className="asset-info">
                        <div className="asset-icon">{t.symbol.charAt(0)}</div>
                        <div>
                          <div className="ticker-symbol">{t.symbol}</div>
                          {/* Note: company_name might not exist in summary view, using symbol for now */}
                          <div className="ticker-name">{t.company_name || 'Company Name'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="price-value">${t.last_close_price?.toFixed(2) || '---'}</div>
                      <div className={isPositive ? 'pnl-positive small' : 'pnl-negative small'}>
                        {isPositive ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} 
                        {/* We don't have daily change %, so just showing overall % trend icon */}
                      </div>
                    </td>
                    <td>
                      <div>{t.total_shares}</div>
                      <div className="text-muted small">Long</div>
                    </td>
                    <td>{t.average_entry_price?.toFixed(4) || '---'}</td>
                    <td className={isPositive ? 'pnl-positive' : 'pnl-negative'}>
                      {isPositive ? '+' : ''}${pnlValue.toFixed(2)}
                    </td>
                    <td className={isPositive ? 'pnl-positive' : 'pnl-negative'}>
                      {isPositive ? '+' : ''}{t.total_unrealized_pnl_pct?.toFixed(2) || '0.00'}%
                    </td>
                    <td>${netValue.toFixed(2)}</td>
                    <td>
                      {pred ? (
                        <span className={`badge badge-${pred.action.toLowerCase().replace('_more', '')}`}>
                          {pred.action.replace('_', ' ')}
                        </span>
                      ) : (
                        <span className="text-muted small">Pending...</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        {selectedTicker && (
          <div className="modal-inner">
            <div className="modal-header-info">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  {selectedTicker.symbol} Deep Dive
                  <button 
                    onClick={handleRunAnalysis}
                    disabled={analysisLoading}
                    style={{
                      padding: '0.4rem 0.75rem', borderRadius: '4px', fontSize: '0.875rem',
                      background: 'transparent', color: 'white', border: '1px solid var(--accent-green)',
                      cursor: analysisLoading ? 'not-allowed' : 'pointer', fontWeight: 500,
                      opacity: analysisLoading ? 0.7 : 1
                    }}
                  >
                    {analysisLoading ? 'Analyzing...' : 'Run Analysis Now'}
                  </button>
                </h2>
                <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Avg Entry: ${selectedTicker.average_entry_price?.toFixed(2)} | 
                  Total Shares: {selectedTicker.total_shares} |
                  Open Date: {selectedTicker.open_date || 'N/A'}
                </p>
              </div>
              {selectedPrediction && (
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge badge-${selectedPrediction.action.toLowerCase().replace('_more', '')}`}>
                    {selectedPrediction.action.replace('_', ' ')}
                  </span>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Conviction: {selectedPrediction.conviction_score}/10
                  </div>
                </div>
              )}
            </div>

            {analysisStatus.message && (
              <div style={{ 
                marginBottom: '1.5rem', padding: '0.75rem', borderRadius: '6px', fontSize: '0.875rem',
                background: analysisStatus.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: analysisStatus.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
                border: `1px solid ${analysisStatus.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
              }}>
                {analysisStatus.message}
              </div>
            )}

            {/* Entry date passing to StockChart for markers */}
            <StockChart 
              symbol={selectedTicker.symbol} 
              entryDate={selectedTicker.open_date}
              entryPrice={selectedTicker.average_entry_price}
              currentPrice={selectedTicker.last_close_price}
            />

            {/* AI Synthesis Section */}
            <div className="ai-summary glass-panel" style={{ marginTop: '2rem', background: 'rgba(59, 130, 246, 0.05)' }}>
              <h3>AI Synthesis & Rationale</h3>
              {selectedPrediction ? (
                <>
                  <ul className="rationale-list">
                    {Array.isArray(selectedPrediction.rationale) 
                      ? selectedPrediction.rationale.map((r, i) => <li key={i}>{r}</li>)
                      : <li>{typeof selectedPrediction.rationale === 'string' ? selectedPrediction.rationale : 'No detailed rationale provided.'}</li>
                    }
                  </ul>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1rem', textAlign: 'right' }}>
                    Last updated: {new Date(selectedPrediction.created_at).toLocaleString()}
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>AI Synthesis is pending for this asset. Check back later after the next analysis run.</p>
              )}
            </div>

            {/* News Section */}
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <BookOpen size={18} /> Recent News Flow
              </h3>
              {news && news.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {news.map(n => (
                    <a 
                      key={n.id} 
                      href={n.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      <div className="glass-panel news-card">
                        <h4 style={{ fontSize: '1rem', fontWeight: 500 }}>{n.headline}</h4>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                          <span>{n.source}</span>
                          <span>{new Date(n.published_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  No recent news found for {selectedTicker.symbol}.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Dashboard;
