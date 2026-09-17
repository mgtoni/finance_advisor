import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StockChart from './StockChart';
import Modal from './Modal';
import { Activity, BookOpen, TrendingUp, TrendingDown, PieChart as PieChartIcon, Target } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import SmartText from './SmartText';
import { glossary } from '../data/glossary';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

const CustomPieTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div style={{ background: '#ffffff', color: '#000000', border: '1px solid #ccc', borderRadius: '4px', padding: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <p style={{ margin: 0, fontWeight: 'bold' }}>{data.name}: {data.value}%</p>
        {data.assets && data.assets.length > 0 && (
          <p style={{ margin: '5px 0 0 0', fontSize: '0.85rem', color: '#333' }}>Assets: {data.assets.join(', ')}</p>
        )}
      </div>
    );
  }
  return null;
};

const Dashboard = () => {
  const [tickers, setTickers] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedFundamentals, setSelectedFundamentals] = useState(null);
  const [news, setNews] = useState([]);
  const [portfolioMetrics, setPortfolioMetrics] = useState(null);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'symbol', direction: 'asc' });
  const [portfolioAnalysis, setPortfolioAnalysis] = useState(null);
  const [newsTierFilter, setNewsTierFilter] = useState('All');
  
  // New States for Macro & Discovery
  const [macroData, setMacroData] = useState(null);
  const [discoveryPicks, setDiscoveryPicks] = useState([]);

  // New state for individual positions fractional closing
  const [individualPositions, setIndividualPositions] = useState([]);
  const [closeInputs, setCloseInputs] = useState({});
  const [closeLoading, setCloseLoading] = useState(false);

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

      // 1.5 Fetch company names from tickers table
      const { data: tickersInfo } = await supabase.from('tickers').select('symbol, company_name');
      const companyNamesMap = {};
      if (tickersInfo) {
        tickersInfo.forEach(t => {
          companyNamesMap[t.symbol] = t.company_name;
        });
      }

      const enhancedTickerData = tickerData ? tickerData.map(t => ({
        ...t,
        company_name: companyNamesMap[t.symbol] || ''
      })) : [];

      setTickers(enhancedTickerData);

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

      // 3. Fetch Portfolio Analysis
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${apiUrl}/api/portfolio-analysis`);
        if (response.ok) {
           const analysisRes = await response.json();
           if (analysisRes.status === 'success') {
               setPortfolioAnalysis(analysisRes.data);
           }
        }
      } catch (err) {
        console.error("Error fetching portfolio analysis", err);
      }

      // 4. Fetch Portfolio Metrics (Sharpe, Correlation)
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const metricsRes = await fetch(`${apiUrl}/api/portfolio-metrics`);
        if (metricsRes.ok) {
           const metricsData = await metricsRes.json();
           if (metricsData.status === 'success') {
               setPortfolioMetrics(metricsData.data);
           }
        }
      } catch (err) {
        console.error("Error fetching portfolio metrics", err);
      }

      // 5. Fetch Macro Data
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const macroRes = await fetch(`${apiUrl}/api/macro-data`);
        if (macroRes.ok) {
           const macroJson = await macroRes.json();
           if (macroJson.status === 'success') {
               setMacroData(macroJson.data);
           }
        }
      } catch (err) {
        console.error("Error fetching macro data", err);
      }

      // 6. Fetch Discovery Picks
      try {
        const { data: discoveryData, error: discoveryError } = await supabase
          .from('discovery_picks')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5);
        if (!discoveryError) {
          setDiscoveryPicks(discoveryData || []);
        }
      } catch (err) {
        console.error("Error fetching discovery picks", err);
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

    // Fetch individual positions (tax lots)
    try {
      const { data: positionsData, error: positionsError } = await supabase
        .from('positions')
        .select('*')
        .eq('symbol', ticker.symbol)
        .order('open_date', { ascending: false });
        
      if (!positionsError) {
        setIndividualPositions(positionsData || []);
        // Initialize close inputs with max shares
        const initialInputs = {};
        (positionsData || []).forEach(p => {
          initialInputs[p.id] = p.shares;
        });
        setCloseInputs(initialInputs);
      }
    } catch (err) {
      console.error('Error fetching individual positions:', err);
    }

    // Fetch fundamentals
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiUrl}/api/fundamentals/${ticker.symbol}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setSelectedFundamentals({
            ...data.data,
            quarterly: data.quarterly,
            macro_analysis: data.macro_analysis
          });
        }
      }
    } catch (err) {
      console.error('Error fetching fundamentals:', err);
    }
    
    setActiveTab('Overview');
  };

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState({ type: '', message: '' });

  const handleClosePosition = async (positionId) => {
    const sharesToClose = parseFloat(closeInputs[positionId]);
    if (isNaN(sharesToClose) || sharesToClose <= 0) return;
    
    setCloseLoading(true);
    setAnalysisStatus({ type: '', message: '' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/close-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: positionId, shares_to_close: sharesToClose })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to close position');
      
      setAnalysisStatus({ type: 'success', message: data.message });
      
      // Refresh dashboard data
      await fetchDashboardData();
      
      // Re-fetch individual positions
      const { data: positionsData } = await supabase
        .from('positions')
        .select('*')
        .eq('symbol', selectedTicker.symbol)
        .order('open_date', { ascending: false });
      
      setIndividualPositions(positionsData || []);
      const newInputs = {};
      (positionsData || []).forEach(p => {
        newInputs[p.id] = p.shares; // reset to new max
      });
      setCloseInputs(newInputs);
      
      // Auto-hide success message
      setTimeout(() => setAnalysisStatus({ type: '', message: '' }), 3000);
    } catch (err) {
      console.error(err);
      setAnalysisStatus({ type: 'error', message: err.message || 'Failed to close position.' });
    } finally {
      setCloseLoading(false);
    }
  };

  const handleRunAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisStatus({ type: '', message: '' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/run-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedTicker.symbol })
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

  const filteredTickers = tickers.filter(t => {
    if (!filterText) return true;
    const term = filterText.toLowerCase();
    const pred = predictions[t.symbol];
    const totalInvested = (t.total_shares * t.average_entry_price) || 0;
    const netValue = (t.total_shares * t.last_close_price) || 0;
    
    return (
      t.symbol.toLowerCase().includes(term) ||
      (t.company_name && t.company_name.toLowerCase().includes(term)) ||
      t.last_close_price?.toString().includes(term) ||
      t.total_shares?.toString().includes(term) ||
      t.average_entry_price?.toString().includes(term) ||
      totalInvested.toFixed(2).includes(term) ||
      t.total_unrealized_pnl_fiat?.toString().includes(term) ||
      t.total_unrealized_pnl_pct?.toString().includes(term) ||
      netValue.toFixed(2).includes(term) ||
      (pred && pred.action.toLowerCase().includes(term)) ||
      (pred && pred.conviction_score?.toString().includes(term))
    );
  });

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getValueForSort = (t, key) => {
    const pred = predictions[t.symbol];
    if (key === 'symbol') return t.symbol;
    if (key === 'last_close_price') return t.last_close_price || 0;
    if (key === 'total_shares') return t.total_shares || 0;
    if (key === 'average_entry_price') return t.average_entry_price || 0;
    if (key === 'totalInvested') return (t.total_shares * t.average_entry_price) || 0;
    if (key === 'total_unrealized_pnl_fiat') return t.total_unrealized_pnl_fiat || 0;
    if (key === 'total_unrealized_pnl_pct') return t.total_unrealized_pnl_pct || 0;
    if (key === 'netValue') return (t.total_shares * t.last_close_price) || 0;
    if (key === 'conviction') return pred?.conviction_score || 0;
    if (key === 'recommendation') return pred?.action || '';
    return 0;
  };

  const sortedTickers = [...filteredTickers].sort((a, b) => {
    const valA = getValueForSort(a, sortConfig.key);
    const valB = getValueForSort(b, sortConfig.key);
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const getSortIndicator = (key) => {
    if (sortConfig.key === key) {
      return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
    }
    return '';
  };

  return (
    <div className="dashboard-container">
      
      {/* Macro Environment Panel */}
      {macroData && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '4px solid #F59E0B' }}>
           <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
              <Activity size={20} color="#F59E0B" /> 
              Global Macro Environment
           </h3>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
              <div>
                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>10Y Treasury Yield</div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{macroData.treasury_10y_yield?.toFixed(2)}%</div>
              </div>
              <div>
                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }} title="Negative means inverted (recession signal)">Yield Curve (10Y-3M)</div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: macroData.yield_curve_10y_3m < 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {macroData.yield_curve_10y_3m?.toFixed(2)}%
                 </div>
              </div>
              <div>
                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Gold (GLD)</div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>${macroData.gold?.toFixed(2)}</div>
              </div>
              <div>
                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Crude Oil (USO)</div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>${macroData.oil?.toFixed(2)}</div>
              </div>
              <div>
                 <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }} title="Rising = Bullish, Falling = Credit Stress">Credit Spread (HYG/LQD)</div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{macroData.credit_spread_hyg_lqd_ratio?.toFixed(2)}</div>
              </div>
           </div>
           
           {macroData.economic_calendar && macroData.economic_calendar.length > 0 && (
             <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Upcoming High-Impact Events (This Week)</h4>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {macroData.economic_calendar.map((ev, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                       <strong style={{ color: 'var(--accent-red)' }}>{ev.country}</strong> {ev.title} ({ev.date})
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>
      )}

      {portfolioAnalysis && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 500px' }}>
             <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <PieChartIcon size={20} color="var(--accent-blue)" /> 
                Portfolio Analysis (AI)
             </h3>
             <div style={{ marginBottom: '1rem' }}>
                <span className={`badge badge-${portfolioAnalysis.action?.toLowerCase() || 'hold'}`}>
                  {portfolioAnalysis.action || 'HOLD'}
                </span>
                <span style={{ marginLeft: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Risk Level: <strong>{portfolioAnalysis.risk_level || 'UNKNOWN'}</strong>
                </span>
             </div>
             {portfolioMetrics && (
                <div style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Sharpe Ratio (1Y): <strong style={{ color: portfolioMetrics.sharpe_ratio > 1 ? 'var(--accent-green)' : 'white' }}>
                    {portfolioMetrics.sharpe_ratio?.toFixed(2) || '0.00'}
                  </strong>
                </div>
             )}
             <ul className="rationale-list" style={{ fontSize: '0.9rem' }}>
                {(portfolioAnalysis.rationale || []).map((r, i) => <li key={i}><SmartText text={r} /></li>)}
             </ul>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 250px', gap: '3rem', marginLeft: '50px', marginTop: '50px' }}>
            <div style={{ height: '300px' }}>
              <h4 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Sector Breakdown</h4>
              {portfolioAnalysis.sector_breakdown ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(portfolioAnalysis.sector_breakdown).map(([name, value]) => ({ 
                        name, 
                        value,
                        assets: portfolioAnalysis.sector_assets?.[name] || []
                      }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={100} fill="#8884d8" paddingAngle={5} dataKey="value"
                      label={({name}) => name}
                    >
                      {Object.entries(portfolioAnalysis.sector_breakdown).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-muted" style={{ textAlign: 'center' }}>No sector data.</p>}
            </div>
            
            <div style={{ height: '300px', marginTop: '70px' }}>
              <h4 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Country Breakdown</h4>
              {portfolioAnalysis.country_breakdown ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(portfolioAnalysis.country_breakdown).map(([name, value]) => ({ 
                        name, 
                        value,
                        assets: portfolioAnalysis.country_assets?.[name] || []
                      }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={100} fill="#8884d8" paddingAngle={5} dataKey="value"
                      label={({name}) => name}
                    >
                      {Object.entries(portfolioAnalysis.country_breakdown).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-muted" style={{ textAlign: 'center' }}>No country data.</p>}
            </div>
          </div>

          <div style={{ flex: '1 1 100%', marginTop: '1rem' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-secondary)' }} title="Shows how assets move relative to each other (1 = perfectly together, -1 = perfectly opposite). Assets missing data are excluded. Lower correlation means better diversification.">
               1Y Correlation Matrix ⓘ
            </h4>
            {portfolioMetrics && portfolioMetrics.correlation && Object.keys(portfolioMetrics.correlation).length > 0 ? (
               <div className="table-responsive" style={{ height: '300px', overflow: 'auto', resize: 'vertical' }}>
                 <table className="portfolio-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                   <thead>
                     <tr>
                       <th style={{ position: 'sticky', left: 0, background: 'var(--bg-card)' }}></th>
                       {Object.keys(portfolioMetrics.correlation).map(sym => <th key={sym}>{sym}</th>)}
                     </tr>
                   </thead>
                   <tbody>
                     {Object.keys(portfolioMetrics.correlation).map(symRow => (
                       <tr key={symRow}>
                         <td style={{ fontWeight: 'bold', position: 'sticky', left: 0, background: 'var(--bg-card)' }}>{symRow}</td>
                         {Object.keys(portfolioMetrics.correlation).map(symCol => {
                           const val = portfolioMetrics.correlation[symRow][symCol];
                           let bgColor = 'transparent';
                           if (val > 0.8 && symRow !== symCol) bgColor = 'rgba(239, 68, 68, 0.2)'; // High correlation
                           if (val < 0.2) bgColor = 'rgba(16, 185, 129, 0.2)'; // Low/Negative correlation
                           return (
                             <td key={symCol} style={{ background: bgColor, textAlign: 'center' }}>
                               {val !== null ? val.toFixed(2) : '-'}
                             </td>
                           )
                         })}
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            ) : <p className="text-muted" style={{ textAlign: 'center' }}>No correlation data.</p>}
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem', paddingLeft: '1rem', paddingRight: '1rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Activity size={20} color="var(--accent-blue)" /> 
            Portfolio Performance
          </h2>
          <input 
            type="text" 
            placeholder="Filter all columns..." 
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px',
              background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
              color: 'white', outline: 'none', width: '250px'
            }}
          />
        </div>
        
        <div className="table-responsive">
          <table className="portfolio-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('symbol')} style={{cursor: 'pointer'}}>Asset{getSortIndicator('symbol')}</th>
                <th onClick={() => handleSort('last_close_price')} style={{cursor: 'pointer'}}>Price{getSortIndicator('last_close_price')}</th>
                <th onClick={() => handleSort('total_shares')} style={{cursor: 'pointer'}}>Units{getSortIndicator('total_shares')}</th>
                <th onClick={() => handleSort('average_entry_price')} style={{cursor: 'pointer'}}>Avg. Open{getSortIndicator('average_entry_price')}</th>
                <th onClick={() => handleSort('totalInvested')} style={{cursor: 'pointer'}}>Total Invested{getSortIndicator('totalInvested')}</th>
                <th onClick={() => handleSort('total_unrealized_pnl_fiat')} style={{cursor: 'pointer'}}>P/L{getSortIndicator('total_unrealized_pnl_fiat')}</th>
                <th onClick={() => handleSort('total_unrealized_pnl_pct')} style={{cursor: 'pointer'}}>P/L(%){getSortIndicator('total_unrealized_pnl_pct')}</th>
                <th onClick={() => handleSort('netValue')} style={{cursor: 'pointer'}}>Net Value{getSortIndicator('netValue')}</th>
                <th onClick={() => handleSort('conviction')} style={{cursor: 'pointer'}}>Conviction{getSortIndicator('conviction')}</th>
                <th onClick={() => handleSort('recommendation')} style={{cursor: 'pointer'}}>Recommendation{getSortIndicator('recommendation')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedTickers.map(t => {
                const isPositive = t.total_unrealized_pnl_pct >= 0;
                const pnlValue = t.total_unrealized_pnl_fiat || 0;
                const netValue = (t.total_shares * t.last_close_price) || 0;
                const totalInvested = (t.total_shares * t.average_entry_price) || 0;
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
                    <td>${t.average_entry_price?.toFixed(4) || '---'}</td>
                    <td>${totalInvested.toFixed(2)}</td>
                    <td className={isPositive ? 'pnl-positive' : 'pnl-negative'}>
                      {isPositive ? '+' : '-'}${Math.abs(pnlValue).toFixed(2)}
                    </td>
                    <td className={isPositive ? 'pnl-positive' : 'pnl-negative'}>
                      {isPositive ? '+' : ''}{t.total_unrealized_pnl_pct?.toFixed(2) || '0.00'}%
                    </td>
                    <td>${netValue.toFixed(2)}</td>
                    <td>
                      {pred ? (
                        <div style={{ fontWeight: 600 }}>{pred.conviction_score}/10</div>
                      ) : (
                        <span className="text-muted small">---</span>
                      )}
                    </td>
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

      {/* AI Discovery Engine Panel */}
      {discoveryPicks && discoveryPicks.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '4px solid var(--accent-blue)' }}>
           <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', color: 'var(--text-primary)' }}>
              <Target size={20} color="var(--accent-blue)" /> 
              AI Discovery Engine - Draft Picks
           </h3>
           <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
              These assets were automatically identified by the AI to perfectly balance your current portfolio concentration risks and sector gaps.
           </p>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {discoveryPicks.map(pick => (
                 <div key={pick.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                       <div>
                          <h4 style={{ fontSize: '1.25rem', margin: 0, color: 'white' }}>{pick.symbol}</h4>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{pick.company_name} • {pick.sector}</div>
                       </div>
                       <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: pick.quant_score > 0 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                             {pick.quant_score}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Quant Score</div>
                       </div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem', marginTop: '1rem' }}>
                       <strong style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>AI Investment Thesis</strong>
                       <ul style={{ paddingLeft: '1rem', margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                          {(pick.thesis || []).map((point, idx) => (
                             <li key={idx} style={{ marginBottom: '0.5rem' }}>{point}</li>
                          ))}
                       </ul>
                    </div>
                 </div>
              ))}
           </div>
        </div>
      )}

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

            {/* Tabs Header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--panel-border)', marginBottom: '1.5rem', marginTop: '1rem', overflowX: 'auto' }}>
               {['Overview', 'Fundamentals', 'Financials', 'News', 'Learn'].map(tab => (
                  <button 
                    key={tab} 
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '0.75rem 1.5rem', background: 'transparent', border: 'none',
                      color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      borderBottom: activeTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      cursor: 'pointer', fontWeight: activeTab === tab ? 600 : 400,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {tab}
                  </button>
               ))}
            </div>

            {activeTab === 'Overview' && (
              <>
                <StockChart 
                  symbol={selectedTicker.symbol} 
                  positions={individualPositions}
                  currentPrice={selectedTicker.last_close_price}
                />
                
                {selectedPrediction && selectedPrediction.rationale && (
                  <div className="glass-panel" style={{ marginTop: '2rem', padding: '1.5rem', borderLeft: '4px solid var(--accent-blue)' }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Target size={20} color="var(--accent-blue)"/> AI Quantitative Analysis
                    </h3>
                    <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.6 }}>
                      {selectedPrediction.rationale.map((r, i) => (
                        <li key={i}><SmartText text={r} /></li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: '2rem' }}>
                  <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <Activity size={18} /> Individual Tax Lots
                  </h3>
              {individualPositions && individualPositions.length > 0 ? (
                <div className="table-responsive">
                  <table className="portfolio-table" style={{ fontSize: '0.875rem' }}>
                    <thead>
                      <tr>
                        <th>Open Date</th>
                        <th>Entry Price</th>
                        <th>Current Shares</th>
                        <th>Invested Amount</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {individualPositions.map(pos => (
                        <tr key={pos.id}>
                          <td>{pos.open_date}</td>
                          <td>${Number(pos.entry_price).toFixed(2)}</td>
                          <td>{pos.shares}</td>
                          <td>
                            ${(pos.shares * pos.entry_price).toFixed(2)}
                          </td>
                          <td>
                            <button
                              onClick={() => handleClosePosition(pos.id)}
                              disabled={closeLoading}
                              style={{
                                padding: '0.25rem 0.5rem', background: 'var(--accent-red)', color: 'white', border: 'none', borderRadius: '4px', cursor: closeLoading ? 'not-allowed' : 'pointer', opacity: closeLoading ? 0.7 : 1
                              }}
                            >
                              Close
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>No open positions found.</p>
              )}
            </div>
            {/* End Overview Tab Content */}
              </>
            )}

            {activeTab === 'Fundamentals' && (
              <div style={{ marginTop: '1rem' }}>
                 <div className="glass-panel" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                    <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Macro & Fundamental Analysis</h3>
                    {selectedFundamentals && selectedFundamentals.macro_analysis ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.95rem' }}>
                        <div>
                           <div style={{ color: 'var(--accent-blue)', marginBottom: '0.5rem', fontWeight: 'bold' }}>Macro Environment</div>
                           <div style={{ lineHeight: '1.6' }}><SmartText text={selectedFundamentals.macro_analysis.macro_environment} /></div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--accent-blue)', marginBottom: '0.5rem', fontWeight: 'bold' }}>Sector Tailwinds & Risks</div>
                           <div style={{ lineHeight: '1.6' }}><SmartText text={selectedFundamentals.macro_analysis.sector_analysis} /></div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--accent-blue)', marginBottom: '0.5rem', fontWeight: 'bold' }}>Fundamental Health</div>
                           <div style={{ lineHeight: '1.6' }}><SmartText text={selectedFundamentals.macro_analysis.fundamental_health} /></div>
                        </div>
                      </div>
                    ) : <p className="text-muted small">Loading macro analysis...</p>}
                 </div>
              </div>
            )}

            {activeTab === 'Financials' && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', flexDirection: 'column' }}>
                 <div className="glass-panel" style={{ flex: '1 1 100%', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Key Metrics</h3>
                    {selectedFundamentals ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', fontSize: '0.95rem' }}>
                        <div>
                           <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>P/E Ratio</div>
                           <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedFundamentals.trailing_pe?.toFixed(2) || 'N/A'}</div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Forward P/E</div>
                           <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedFundamentals.forward_pe?.toFixed(2) || 'N/A'}</div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>P/B Ratio</div>
                           <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedFundamentals.price_to_book?.toFixed(2) || 'N/A'}</div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Debt/Equity</div>
                           <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedFundamentals.debt_to_equity?.toFixed(2) || 'N/A'}</div>
                        </div>
                        <div>
                           <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>ROE</div>
                           <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{(selectedFundamentals.return_on_equity * 100)?.toFixed(2) || 'N/A'}%</div>
                        </div>
                      </div>
                    ) : <p className="text-muted small">Loading metrics...</p>}
                 </div>

                 <div className="glass-panel" style={{ flex: '1 1 100%', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Quarterly Financials</h3>
                    {selectedFundamentals && selectedFundamentals.quarterly && selectedFundamentals.quarterly.length > 0 ? (
                      <div className="table-responsive">
                        <table className="portfolio-table" style={{ fontSize: '0.875rem' }}>
                          <thead>
                            <tr>
                              <th>Metric</th>
                              {selectedFundamentals.quarterly.map(q => <th key={q.date}>{q.date}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(selectedFundamentals.quarterly[0]).filter(k => k !== 'date' && k !== 'Tax Effect Of Unusual Items' && k !== 'Tax Rate For Calcs').slice(0, 8).map(metric => (
                              <tr key={metric}>
                                <td>{metric}</td>
                                {selectedFundamentals.quarterly.map(q => {
                                  const val = q[metric];
                                  return (
                                    <td key={q.date}>
                                      {val ? (val > 1000000 ? `$${(val/1000000).toFixed(1)}M` : `$${val.toLocaleString()}`) : '-'}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-muted small">Loading quarterly financials...</p>}
                 </div>
              </div>
            )}

            {activeTab === 'News' && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <BookOpen size={18} /> Recent News Flow & Impact
                  </h3>
                  <select 
                    value={newsTierFilter} 
                    onChange={e => setNewsTierFilter(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid var(--panel-border)', padding: '0.5rem', borderRadius: '4px' }}
                  >
                    <option value="All">All Tiers</option>
                    <option value="1">Tier 1 Only</option>
                    <option value="2">Tier 2 & Above</option>
                  </select>
                </div>
                <p className="small text-muted" style={{ marginBottom: '1rem' }}>
                   Sources are tiered by reliability. Sentiment scores range from -1.0 (Negative) to 1.0 (Positive).
                </p>
                {news && news.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {news.filter(n => {
                      if (newsTierFilter === 'All') return true;
                      const tier = parseInt(n.source_tier || 3);
                      return tier <= parseInt(newsTierFilter);
                    }).map(n => {
                      const sentimentColor = n.sentiment_score > 0.2 ? 'var(--accent-green)' : n.sentiment_score < -0.2 ? 'var(--accent-red)' : 'var(--text-secondary)';
                      return (
                        <a 
                          key={n.id} 
                          href={n.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <div className="glass-panel news-card">
                            <h4 style={{ fontSize: '1rem', fontWeight: 500 }}>{n.headline}</h4>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                              <span>
                                 {n.source} 
                                 <span style={{ marginLeft: '0.5rem', padding: '0.1rem 0.4rem', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Tier {n.source_tier || 3}</span>
                              </span>
                              <span>{new Date(n.published_at).toLocaleString()}</span>
                            </div>
                            {n.impact_summary && (
                              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-primary)', borderLeft: `3px solid ${sentimentColor}`, paddingLeft: '0.5rem' }}>
                                <strong>AI Impact Analysis:</strong> {n.impact_summary}
                              </div>
                            )}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    No recent news found for {selectedTicker.symbol}.
                  </p>
                )}
              </div>
            )}
            
            {activeTab === 'Learn' && (
              <div style={{ marginTop: '1rem' }}>
                 <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Financial Glossary & Education</h3>
                 <p className="small text-muted" style={{ marginBottom: '1rem' }}>Hover over these terms throughout the application to see their definitions.</p>
                 <div className="glass-panel" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                    <ul style={{ lineHeight: '1.8', listStyleType: 'none', padding: 0, margin: 0 }}>
                      {Object.keys(glossary).sort().map(term => (
                        <li key={term} style={{ marginBottom: '1.5rem' }}>
                          <strong style={{ color: 'var(--accent-blue)', fontSize: '1.1rem' }}>{term}:</strong> 
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{glossary[term]}</p>
                        </li>
                      ))}
                    </ul>
                 </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Dashboard;
