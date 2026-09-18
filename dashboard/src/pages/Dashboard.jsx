import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StockChart from '../components/StockChart';
import Modal from '../components/Modal';
import { Activity, BookOpen, TrendingUp, TrendingDown, PieChart as PieChartIcon, Target } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import SmartText from '../components/SmartText';
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

const MacroMetricCard = ({ title, value, colorClass, educationalText }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        {title} ⓘ
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: colorClass || 'inherit' }}>
        {value}
      </div>

      {isHovered && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '0',
          zIndex: 100,
          marginTop: '0.5rem',
          width: '320px',
          background: 'rgba(15, 20, 25, 0.98)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          padding: '1rem',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          color: 'var(--text-primary)',
          fontSize: '0.85rem',
          lineHeight: '1.5',
          pointerEvents: 'none'
        }}>
          {educationalText}
        </div>
      )}
    </div>
  );
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
  const [newsSummary, setNewsSummary] = useState(null);
  const [socialSentiment, setSocialSentiment] = useState(null);

  // New States for Macro & Discovery
  const [macroData, setMacroData] = useState(null);
  const [discoveryPicks, setDiscoveryPicks] = useState([]);
  const [calendarInsights, setCalendarInsights] = useState({});
  const [isDiscovering, setIsDiscovering] = useState(false);

  // New state for individual positions fractional closing
  const [individualPositions, setIndividualPositions] = useState([]);
  const [closeInputs, setCloseInputs] = useState({});
  const [closeLoading, setCloseLoading] = useState(false);
  const [dataFetchedAt, setDataFetchedAt] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const LastRunLabel = ({ date, align = 'left' }) => {
    if (!date) return null;
    const d = new Date(date);
    return (
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', marginTop: '-0.25rem', fontStyle: 'italic', textAlign: align }}>
        Last run on: {d.toLocaleString()}
      </div>
    );
  };

  const fetchDashboardData = async () => {
    try {
      const fetchTime = new Date().toISOString();
      setDataFetchedAt(fetchTime);
      
      // Start all independent fetches concurrently
      const portfolioPromise = supabase.from('portfolio_summary').select('*').order('symbol');
      const tickersInfoPromise = supabase.from('tickers').select('symbol, company_name');
      const apiUrl = import.meta.env.VITE_API_URL || '';

      const macroPromise = fetch(`${apiUrl}/api/macro-data`);
      const discoveryPromise = supabase.from('discovery_picks').select('*').order('created_at', { ascending: false }).limit(5);

      // Wait for the essential ones (portfolio and tickers) to build the core UI
      const [portfolioRes, tickersInfoRes] = await Promise.all([portfolioPromise, tickersInfoPromise]);

      if (portfolioRes.error) throw portfolioRes.error;

      const companyNamesMap = {};
      if (tickersInfoRes.data) {
        tickersInfoRes.data.forEach(t => {
          companyNamesMap[t.symbol] = t.company_name;
        });
      }

      const enhancedTickerData = portfolioRes.data ? portfolioRes.data.map(t => ({
        ...t,
        company_name: companyNamesMap[t.symbol] || ''
      })) : [];

      setTickers(enhancedTickerData);

      // 💥 Core UI Data is ready - Unblock the UI render! 💥
      setLoading(false);

      // Fetch Latest Predictions in parallel, not sequentially
      if (portfolioRes.data && portfolioRes.data.length > 0) {
        const symbols = portfolioRes.data.map(t => t.symbol);
        Promise.all(symbols.map(sym =>
          supabase.from('prediction_logs').select('*').eq('symbol', sym).order('created_at', { ascending: false }).limit(1)
        )).then(results => {
          const preds = {};
          results.forEach((res, index) => {
            if (res.data && res.data.length > 0) {
              preds[symbols[index]] = res.data[0];
            }
          });
          setPredictions(preds);
        }).catch(err => console.error("Error fetching predictions", err));
      }

      // Handle macro data asynchronously
      macroPromise.then(res => {
        if (res.ok) return res.json();
        throw new Error("Macro fetch failed");
      }).then(macroJson => {
        if (macroJson.status === 'success') {
          setMacroData(macroJson.data);
          // Fire off async fetch for calendar insights
          if (macroJson.data.economic_calendar && macroJson.data.economic_calendar.length > 0) {
            fetch(`${apiUrl}/api/generate-calendar-insights`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ events: macroJson.data.economic_calendar })
            }).then(res => res.json()).then(data => {
              if (data.status === 'success') {
                setCalendarInsights(data.insights);
              }
            }).catch(console.error);
          }
        }
      }).catch(err => console.error("Error fetching macro data", err));

      // Handle discovery picks asynchronously
      discoveryPromise.then(({ data, error }) => {
        if (!error && data) {
          setDiscoveryPicks(data);
        }
      }).catch(err => console.error("Error fetching discovery picks", err));

      // Fire off Portfolio Analysis asynchronously
      fetch(`${apiUrl}/api/portfolio-analysis`)
        .then(res => res.json())
        .then(analysisRes => {
          if (analysisRes.status === 'success') {
            setPortfolioAnalysis(analysisRes.data);
          }
        })
        .catch(err => console.error("Error fetching portfolio analysis", err));

      // Fire off Portfolio Metrics asynchronously
      fetch(`${apiUrl}/api/portfolio-metrics`)
        .then(res => res.json())
        .then(metricsData => {
          if (metricsData.status === 'success') {
            setPortfolioMetrics(metricsData.data);
          }
        })
        .catch(err => console.error("Error fetching portfolio metrics", err));

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setFetchError(error.message);
      setLoading(false);
    }
  };

  const forceRefreshPortfolioAnalysis = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const analysisRes = await fetch(`${apiUrl}/api/portfolio-analysis?force=true`);
      if (analysisRes.ok) {
        const analysisJson = await analysisRes.json();
        if (analysisJson.status === 'success') {
          setPortfolioAnalysis(analysisJson.data);
          alert("AI Portfolio Analysis forced refresh complete!");
        }
      }
    } catch (err) {
      console.error("Error forcing refresh", err);
    }
  };

  const handleRowClick = async (ticker) => {
    setSelectedTicker(ticker);
    setSelectedPrediction(predictions[ticker.symbol] || null);
    setIsModalOpen(true);
    setNewsSummary(null);
    setSocialSentiment(null);

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

    // Fetch News Summary asynchronously
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/news-summary/${ticker.symbol}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') setNewsSummary(data.summary);
      })
      .catch(err => console.error("Error fetching news summary", err));

    // Fetch Social Sentiment asynchronously
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/social-sentiment/${ticker.symbol}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') setSocialSentiment(data.data);
      })
      .catch(err => console.error("Error fetching social sentiment", err));

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
          <LastRunLabel date={dataFetchedAt} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1.5rem', paddingBottom: '1rem' }}>
            <MacroMetricCard
              title="10Y Treasury Yield"
              value={`${macroData.treasury_10y_yield?.toFixed(2)}%`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The "Risk-Free" Rate</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>The 10-Year Yield represents the baseline return investors can get from the US government without taking stock market risk.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> Think of this as financial gravity. When yields rise sharply, stocks (especially tech and growth) get pulled down because their future cash flows become less valuable compared to safe bonds.</p>
                  <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.8rem', fontStyle: 'italic' }}>When yields cross 4.5%+, the AI flags high-PE stocks for immediate risk assessment.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Yield Curve (10Y-3M)"
              value={`${macroData.yield_curve_10y_3m?.toFixed(2)}%`}
              colorClass={macroData.yield_curve_10y_3m < 0 ? 'var(--accent-red)' : 'var(--accent-green)'}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Recession Predictor</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>Normally, locking money up for 10 years pays more than 3 months. When this curve goes negative ("inverts"), short-term rates are higher than long-term rates.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> An inverted curve breaks the banking business model and is historically the most accurate leading indicator of a severe recession.</p>
                  <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.8rem', fontStyle: 'italic' }}>If inverted, the AI heavily scrutinizes your portfolio for highly leveraged companies facing debt refinancing risks.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Credit Spread (HYG/LQD)"
              value={`${macroData.credit_spread_hyg_lqd_ratio?.toFixed(2)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Corporate Stress Test</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>This is the ratio of High-Yield "Junk" bonds (HYG) to safe Investment Grade bonds (LQD). It measures how terrified lenders are of corporate bankruptcies.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> When the spread widens (ratio drops), investors are demanding huge premiums to lend money to risky companies. A plunging ratio almost always precedes massive equity market sell-offs.</p>
                  <p style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI uses credit spreads to confirm if an ongoing market drop is a healthy pullback or a systemic crisis.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Crude Oil (CL)"
              value={`$${macroData.oil?.toFixed(2)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Broad Inflation Engine</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>Oil powers global transport and manufacturing. When crude prices surge, the cost of almost everything else goes up.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> Surging oil acts as a direct "tax" on consumers. Discretionary spending collapses and margins for airlines, logistics, and retail get violently squeezed.</p>
                  <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI penalizes consumer discretionary stocks in your portfolio when oil breaches $85/bbl.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Gold (GC)"
              value={`$${macroData.gold?.toFixed(2)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Ultimate Safe-Haven</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>Gold acts as a timeless hedge against inflation, currency debasement, and systemic banking collapses.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> A rapidly surging gold price often signals that institutional "smart money" is quietly fleeing risky equities due to fear of major market instability.</p>
                  <p style={{ margin: 0, color: 'var(--accent-green)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI tracks gold breakouts to determine if a defensive portfolio rotation is necessary.</p>
                </>
              }
            />

            <MacroMetricCard
              title="MSCI World Index (URTH)"
              value={`$${macroData.msci_world?.toFixed(2)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Global Market Health</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>This ETF tracks mid- and large-cap representation across 23 Developed Markets globally.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> Provides a view of international market health, moving beyond just the US S&P 500 benchmark.</p>
                  <p style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI uses this to contextualize your international exposure.</p>
                </>
              }
            />

            <MacroMetricCard
              title="EUR/USD"
              value={`${macroData.eur_usd?.toFixed(4)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Global Fiat Liquidity Barometer</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>The most heavily traded currency pair in the world, reflecting the economic dynamic between Europe and the US.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> A weakening Euro often signals stress in the Eurozone or a flight-to-safety into the US Dollar.</p>
                  <p style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI analyzes EUR/USD to detect massive macro shifts in currency hegemony and export competitiveness.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Bitcoin (BTC)"
              value={`$${macroData.btc_usd?.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Apex Liquidity Sponge</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>Regardless of opinion on crypto, institutional Bitcoin trades as a high-beta proxy for global fiat liquidity.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> When global central banks print money or ease conditions, BTC typically rallies first as a hypersensitive leading indicator.</p>
                  <p style={{ margin: 0, color: 'var(--accent-green)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI watches BTC movements to sniff out stealth liquidity injections before they hit legacy markets.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Brent Crude (BZ)"
              value={`$${macroData.brent_oil?.toFixed(2)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>The Global Supply Chain Tax</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>While WTI reflects US oil, Brent Crude is the international benchmark and dictates fuel costs for the majority of the world.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> Critical for tracking global supply chain costs and international inflation pressures.</p>
                  <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI uses Brent to measure true global energy inflation.</p>
                </>
              }
            />

            <MacroMetricCard
              title="Copper-to-Gold (HG/GC)"
              value={`${macroData.copper_gold_ratio?.toFixed(4)}`}
              educationalText={
                <>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Dr. Copper vs The Safe-Haven</h4>
                  <p style={{ margin: '0 0 0.5rem 0' }}>Copper is heavily used in global manufacturing and infrastructure. Gold is a safe-haven asset.</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}><strong>Portfolio Impact:</strong> A rising ratio means global economic expansion and risk-on sentiment. A falling ratio signals global economic contraction or fear.</p>
                  <p style={{ margin: 0, color: 'var(--accent-green)', fontSize: '0.8rem', fontStyle: 'italic' }}>The AI tracks this ratio as the ultimate leading indicator for global economic momentum.</p>
                </>
              }
            />
          </div>

          {macroData.economic_calendar && macroData.economic_calendar.length > 0 && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1rem' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Upcoming High-Impact Events (This Week)</h4>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {macroData.economic_calendar.map((ev, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem 1rem', borderRadius: '4px', fontSize: '0.85rem', maxWidth: '300px' }}>
                    <div style={{ marginBottom: '0.25rem' }}><strong style={{ color: 'var(--accent-red)' }}>{ev.country}</strong> {ev.title} ({ev.date})</div>
                    {calendarInsights[ev.title] ? (
                      <div style={{ color: 'var(--accent-blue)', fontSize: '0.75rem', fontStyle: 'italic', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                        AI Insight: {calendarInsights[ev.title]}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.5rem' }}>Loading AI Insight...</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {portfolioAnalysis ? (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', borderTop: '4px solid #F59E0B' }}>
          <div style={{ flex: '2 1 500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <PieChartIcon size={20} color="var(--accent-blue)" />
                Portfolio Analysis (AI)
              </h3>
              <button onClick={forceRefreshPortfolioAnalysis} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', border: '1px solid var(--panel-border)', background: 'transparent', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                Force Refresh AI
              </button>
            </div>
            <LastRunLabel date={portfolioAnalysis.created_at || dataFetchedAt} />
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '8px' }}>
              <span className={`badge badge-${portfolioAnalysis.action?.toLowerCase() || 'hold'}`} style={{ padding: '0.5rem 1rem', fontSize: '1rem', boxShadow: '0 0 10px rgba(245, 158, 11, 0.3)' }}>
                {portfolioAnalysis.action || 'HOLD'}
              </span>
              <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                Risk Level: <strong style={{ color: portfolioAnalysis.risk_level === 'HIGH' ? 'var(--accent-red)' : portfolioAnalysis.risk_level === 'LOW' ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>{portfolioAnalysis.risk_level || 'UNKNOWN'}</strong>
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
              {portfolioMetrics?.sector_breakdown ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(portfolioMetrics.sector_breakdown).map(([name, value]) => ({
                        name,
                        value,
                        assets: portfolioMetrics.sector_assets?.[name] || []
                      }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={100} fill="#8884d8" paddingAngle={5} dataKey="value"
                      label={({ name }) => name}
                    >
                      {Object.entries(portfolioMetrics.sector_breakdown).map((entry, index) => (
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
              {portfolioMetrics?.country_breakdown ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(portfolioMetrics.country_breakdown).map(([name, value]) => ({
                        name,
                        value,
                        assets: portfolioMetrics.country_assets?.[name] || []
                      }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={100} fill="#8884d8" paddingAngle={5} dataKey="value"
                      label={({ name }) => name}
                    >
                      {Object.entries(portfolioMetrics.country_breakdown).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-muted" style={{ textAlign: 'center' }}>No country data.</p>}
            </div>
          </div>

          <div style={{ flex: '1 1 100%', marginTop: '2rem', padding: '1.5rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-secondary)' }} title="Shows how assets move relative to each other (1 = perfectly together, -1 = perfectly opposite). Assets missing data are excluded. Lower correlation means better diversification.">
              1Y Correlation Matrix ⓘ
            </h4>
            {portfolioMetrics && portfolioMetrics.correlation && Object.keys(portfolioMetrics.correlation).length > 0 ? (
              <div className="table-responsive" style={{ height: '500px', overflow: 'auto', resize: 'vertical' }}>
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
      ) : (
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <h3><PieChartIcon size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} color="var(--accent-blue)" /> Generating AI Portfolio Analysis...</h3>
          <p style={{ fontSize: '0.9rem' }}>The AI is synthesizing macro trends, checking position gaps, and assigning risk levels. This usually takes ~25 seconds.</p>
        </div>
      )}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', borderTop: '4px solid #F59E0B' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem', paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, marginBottom: '0.5rem' }}>
              <Activity size={20} color="var(--accent-blue)" />
              Portfolio Performance
            </h2>
            <LastRunLabel date={dataFetchedAt} />
          </div>
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
                <th onClick={() => handleSort('symbol')} style={{ cursor: 'pointer' }}>Asset{getSortIndicator('symbol')}</th>
                <th onClick={() => handleSort('last_close_price')} style={{ cursor: 'pointer' }}>Price <span style={{ color: '#F59E0B', fontSize: '0.7rem' }}>⚡ Alpaca</span>{getSortIndicator('last_close_price')}</th>
                <th onClick={() => handleSort('total_shares')} style={{ cursor: 'pointer' }}>Units{getSortIndicator('total_shares')}</th>
                <th onClick={() => handleSort('average_entry_price')} style={{ cursor: 'pointer' }}>Avg. Open{getSortIndicator('average_entry_price')}</th>
                <th onClick={() => handleSort('totalInvested')} style={{ cursor: 'pointer' }}>Total Invested{getSortIndicator('totalInvested')}</th>
                <th onClick={() => handleSort('total_unrealized_pnl_fiat')} style={{ cursor: 'pointer' }}>P/L{getSortIndicator('total_unrealized_pnl_fiat')}</th>
                <th onClick={() => handleSort('total_unrealized_pnl_pct')} style={{ cursor: 'pointer' }}>P/L(%){getSortIndicator('total_unrealized_pnl_pct')}</th>
                <th onClick={() => handleSort('netValue')} style={{ cursor: 'pointer' }}>Net Value{getSortIndicator('netValue')}</th>
                <th onClick={() => handleSort('conviction')} style={{ cursor: 'pointer' }}>AI Conviction{getSortIndicator('conviction')}</th>
                <th onClick={() => handleSort('recommendation')} style={{ cursor: 'pointer' }}>Recommendation{getSortIndicator('recommendation')}</th>
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
                        {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
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
              {['Overview', 'Fundamentals', 'Financials', 'News', 'Social', 'Learn'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: 'transparent', border: 'none', padding: '0.5rem 1rem',
                    color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    borderBottom: activeTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    cursor: 'pointer', fontWeight: activeTab === tab ? 'bold' : 'normal',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {tab === 'News' ? 'Institutional News' : tab === 'Social' ? 'Social Sentiment' : tab}
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
                      <Target size={20} color="var(--accent-blue)" /> AI Quantitative Analysis
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
                                    {val ? (val > 1000000 ? `$${(val / 1000000).toFixed(1)}M` : `$${val.toLocaleString()}`) : '-'}
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
                <div style={{ background: 'rgba(0,123,255,0.1)', border: '1px solid rgba(0,123,255,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                  <h4 style={{ color: 'var(--accent-blue)', margin: '0 0 0.5rem 0' }}>AI Earnings Transcript Integration</h4>
                  <p className="small text-muted" style={{ margin: 0 }}>
                    News sources tagged as <strong>Tier 1 (Earnings Calls)</strong> are automatically scraped via DuckDuckGo and fed into the AI's core predictive model.
                    This allows the AI to forecast using management's forward-looking guidance rather than relying solely on past quarterly fundamentals.
                  </p>
                </div>
                {newsSummary ? (
                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-blue)' }}>
                    <strong style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>AI Executive Summary</strong>
                    <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: '1.5' }}>{newsSummary}</p>
                  </div>
                ) : (
                  <div style={{ padding: '1rem', marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Generating AI Summary...</div>
                )}
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
                          className="news-item"
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <div className="news-source">
                              {n.source} <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>• Tier {n.source_tier || '3'}</span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {new Date(n.published_at).toLocaleDateString()}
                            </span>
                          </div>
                          <h4 style={{ margin: '0 0 0.5rem 0', color: 'white', fontSize: '0.95rem' }}>{n.headline}</h4>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                            <span style={{ color: sentimentColor, fontWeight: 'bold', fontSize: '0.85rem' }}>
                              {n.sentiment_score > 0 ? '+' : ''}{n.sentiment_score?.toFixed(2)}
                            </span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    No recent institutional news found.
                  </p>
                )}
              </div>
            )}

            {activeTab === 'Social' && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                  <h4 style={{ color: '#F59E0B', margin: '0 0 0.5rem 0' }}>Social Sentiment Analysis (Tier 3)</h4>
                  <p className="small text-muted" style={{ margin: 0 }}>
                    This tab tracks alternative media and retail forums (e.g., Reddit, r/WallStreetBets, StockTwits).
                    The AI specifically monitors these platforms to detect <strong>retail mania, pump-and-dump schemes, and short-squeeze risks</strong> that institutional news misses.
                  </p>
                </div>
                {socialSentiment ? (
                  socialSentiment.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {socialSentiment.map((n, idx) => {
                        const sentimentColor = n.sentiment_score > 0.2 ? 'var(--accent-green)' : n.sentiment_score < -0.2 ? 'var(--accent-red)' : 'var(--text-secondary)';
                        return (
                          <a
                            key={idx}
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="news-item"
                            style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid #F59E0B' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                              <div className="news-source">
                                {n.source} <span style={{ color: '#F59E0B', fontSize: '0.8rem', marginLeft: '0.5rem' }}>Retail Tracker</span>
                              </div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {new Date(n.published_at).toLocaleDateString()}
                              </span>
                            </div>
                            <h4 style={{ margin: '0 0 0.5rem 0', color: 'white', fontSize: '0.95rem' }}>{n.headline}</h4>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>{n.impact_summary}</p>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                              <span style={{ color: sentimentColor, fontWeight: 'bold', fontSize: '0.85rem' }}>
                                {n.sentiment_score > 0 ? '+' : ''}{n.sentiment_score?.toFixed(2)}
                              </span>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                      No retail or social sentiment data found for {selectedTicker.symbol}.
                    </p>
                  )
                ) : (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem' }}>Loading social sentiment...</p>
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
