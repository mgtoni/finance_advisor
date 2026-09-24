import React, { useState, useEffect, useMemo } from 'react';
import { 
  Target, RefreshCw, Bookmark, BookmarkCheck, Shield, Globe, 
  TrendingUp, DollarSign, Zap, Sparkles, Layers, ChevronRight, 
  ExternalLink, BarChart3, Newspaper, AlertTriangle, CheckCircle2,
  Sliders, ArrowUpRight, Search, Trash2, Info
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal from '../components/Modal';

const STRATEGIES = [
  {
    id: 'non_us',
    title: 'Non-US & Global Gems',
    icon: Globe,
    badge: 'International',
    color: '#3b82f6',
    desc: 'Overlooked champions and leaders across Europe, Asia-Pacific, UK, Canada & Scandinavia.'
  },
  {
    id: 'value',
    title: 'Deep Value & Cash Cows',
    icon: Sparkles,
    badge: 'Low Valuation',
    color: '#10b981',
    desc: 'Fundamentally sound companies with low P/E, high Free Cash Flow yield, and healthy solvency.'
  },
  {
    id: 'income',
    title: 'Income & Dividends',
    icon: DollarSign,
    badge: 'High Yield',
    color: '#f59e0b',
    desc: 'Sustainable dividend yields (>3%), covered by positive operating and free cash flow.'
  },
  {
    id: 'reduce_risk',
    title: 'Reduce Risk & Defensive',
    icon: Shield,
    badge: 'Capital Preservation',
    color: '#8b5cf6',
    desc: 'Low-beta (<0.85), non-cyclical defensive operators with robust balance sheets.'
  },
  {
    id: 'diversification',
    title: 'Portfolio Diversification',
    icon: Layers,
    badge: 'Gap Filler',
    color: '#06b6d4',
    desc: 'Assets selected specifically to hedge missing sectors and geographic exposures.'
  },
  {
    id: 'high_beta',
    title: 'High-Risk / High-Beta',
    icon: Zap,
    badge: 'Asymmetric Growth',
    color: '#ec4899',
    desc: 'High-momentum breakouts and emerging innovators with substantial volatility and upside.'
  }
];

const Discover = () => {
  const [activeTab, setActiveTab] = useState('discover'); // 'discover' | 'watchlist'
  const [selectedStrategy, setSelectedStrategy] = useState('non_us');
  const [marketCapTier, setMarketCapTier] = useState('all'); // 'hidden_gems' | 'large_cap' | 'all'
  const [regionPref, setRegionPref] = useState('global_ex_us'); // 'global_ex_us' | 'europe_uk' | 'asia_pacific' | 'all'
  const [listingType, setListingType] = useState('hybrid'); // 'hybrid' | 'adrs_only' | 'direct_only'
  const [strictHealth, setStrictHealth] = useState(true);

  const [discoveryPicks, setDiscoveryPicks] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryStage, setDiscoveryStage] = useState('Idle');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [dataFetchedAt, setDataFetchedAt] = useState(null);

  // Deep Analysis Modal state
  const [selectedPick, setSelectedPick] = useState(null);
  const [modalTab, setModalTab] = useState('thesis'); // 'thesis' | 'fundamentals' | 'technicals' | 'sentiment' | 'risks'

  const apiUrl = import.meta.env.VITE_API_URL || '';

  const handleSelectStrategy = (stratId) => {
    setSelectedStrategy(stratId);
    if (stratId === 'non_us' && regionPref === 'all') {
      setRegionPref('global_ex_us');
    }
  };

  // ---------------------------------------------------------------------------
  // FETCH PICKS & WATCHLIST
  // ---------------------------------------------------------------------------
  const fetchDiscoveryPicks = async (strat) => {
    setLoading(true);
    try {
      setDataFetchedAt(new Date().toISOString());
      const targetStrat = strat !== undefined ? strat : selectedStrategy;
      const queryParam = targetStrat && targetStrat !== 'all' ? `&strategy=${targetStrat}` : '';
      const res = await fetch(`${apiUrl}/api/discovery-picks?limit=25${queryParam}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setDiscoveryPicks(json.data);
          setLoading(false);
          return;
        }
      }

      // Fallback directly to Supabase client
      let query = supabase.from('discovery_picks').select('*').neq('strategy', 'legacy_archived').order('created_at', { ascending: false }).limit(25);
      if (targetStrat && targetStrat !== 'all') {
        query = query.eq('strategy', targetStrat);
      }
      const { data, error } = await query;
      if (!error && data) {
        setDiscoveryPicks(data);
      }
    } catch (e) {
      console.error("Error fetching discovery picks:", e);
    }
    setLoading(false);
  };

  const fetchWatchlist = async () => {
    setWatchlistLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/watchlist`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setWatchlist(json.data);
          setWatchlistLoading(false);
          return;
        }
      }
      // Fallback to Supabase if backend proxy fails
      const { data, error } = await supabase.from('watchlist').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setWatchlist(data);
      }
    } catch (e) {
      console.error("Error fetching watchlist:", e);
    }
    setWatchlistLoading(false);
  };

  useEffect(() => {
    fetchDiscoveryPicks(selectedStrategy);
  }, [selectedStrategy]);

  useEffect(() => {
    fetchWatchlist();
  }, []);

  // ---------------------------------------------------------------------------
  // RUN DISCOVERY & PROGRESS POLLING
  // ---------------------------------------------------------------------------
  const handleRunDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryStage("Scanning 60+ candidates across global markets...");
    setElapsedTime(0);

    try {
      const res = await fetch(`${apiUrl}/api/run-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: selectedStrategy,
          market_cap_tier: marketCapTier,
          region_preference: regionPref,
          listing_type: listingType,
          strict_health_filter: strictHealth
        })
      });
      if (!res.ok && res.status !== 409) {
        throw new Error("Failed to start discovery");
      }
    } catch(e) {
      console.error("Error triggering discovery:", e);
      setIsDiscovering(false);
      return;
    }

    // Timer & Status Polling
    const timerInterval = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    const pollInterval = setInterval(async () => {
      try {
        const stRes = await fetch(`${apiUrl}/api/discovery-status`);
        if (stRes.ok) {
          const stJson = await stRes.json();
          const data = stJson.data;
          if (data && data.stage) {
            setDiscoveryStage(data.stage);
          }
          if (data && !data.is_running && data.stage === 'Complete') {
            clearInterval(pollInterval);
            clearInterval(timerInterval);
            setIsDiscovering(false);
            fetchDiscoveryPicks(selectedStrategy);
          }
        }
      } catch (err) {
        console.error("Poll status error:", err);
      }
    }, 4000);

    // Timeout safety after 90 seconds
    setTimeout(() => {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
      setIsDiscovering(false);
      fetchDiscoveryPicks(selectedStrategy);
    }, 90000);
  };

  // ---------------------------------------------------------------------------
  // WATCHLIST TOGGLE
  // ---------------------------------------------------------------------------
  const isSymbolInWatchlist = (symbol) => {
    return watchlist.some(item => item.symbol === symbol);
  };

  const handleToggleWatchlist = async (pick) => {
    const symbol = pick.symbol;
    const inWatchlist = isSymbolInWatchlist(symbol);

    if (inWatchlist) {
      // Remove
      setWatchlist(prev => prev.filter(w => w.symbol !== symbol));
      try {
        await fetch(`${apiUrl}/api/watchlist/${symbol}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Error removing from watchlist:", e);
      }
    } else {
      // Add
      const thesisObj = typeof pick.thesis === 'object' && pick.thesis !== null ? pick.thesis : {};
      const newItem = {
        symbol: pick.symbol,
        company_name: pick.company_name,
        sector: pick.sector,
        country: thesisObj.country || pick.country || 'Global',
        price: pick.last_close_price || (pick.fundamental_metrics?.market_cap ? null : 0),
        added_from: selectedStrategy,
        notes: `Discovered under ${selectedStrategy} strategy.`
      };
      setWatchlist(prev => [newItem, ...prev]);
      try {
        await fetch(`${apiUrl}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItem)
        });
      } catch (e) {
        console.error("Error adding to watchlist:", e);
      }
    }
  };

  const handleRemoveFromWatchlist = async (symbol) => {
    setWatchlist(prev => prev.filter(w => w.symbol !== symbol));
    try {
      await fetch(`${apiUrl}/api/watchlist/${symbol}`, { method: 'DELETE' });
    } catch (e) {
      console.error("Error removing from watchlist:", e);
    }
  };

  // ---------------------------------------------------------------------------
  // UTILITY FORMATTERS
  // ---------------------------------------------------------------------------
  const formatMcap = (val) => {
    if (!val) return 'N/A';
    if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
    return `$${val.toLocaleString()}`;
  };

  const formatPct = (val) => {
    if (val === null || val === undefined) return 'N/A';
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return 'N/A';
    // If between 0 and 1, likely fraction e.g. 0.045 -> 4.5%
    if (num > -1 && num < 1 && num !== 0) return `${(num * 100).toFixed(1)}%`;
    return `${num.toFixed(1)}%`;
  };

  const getScoreColor = (score) => {
    if (score >= 75) return 'var(--accent-green)';
    if (score >= 50) return 'var(--accent-blue)';
    return '#f59e0b';
  };

  // Extract structured data from pick (handles both extended schema & thesis JSONB fallback)
  const extractPickDetails = (pick) => {
    const rawThesis = pick.thesis;
    const isPayload = typeof rawThesis === 'object' && rawThesis !== null && !Array.isArray(rawThesis);
    
    const dossier = isPayload ? (rawThesis.dossier || rawThesis) : {};
    const fundamentals = pick.fundamental_metrics || (isPayload ? rawThesis.fundamental_metrics : {}) || {};
    const technicals = pick.technical_scores || (isPayload ? rawThesis.technical_scores : {}) || {};
    const sentiment = pick.sentiment_data || (isPayload ? rawThesis.sentiment_data : {}) || {};
    
    const strategy = pick.strategy || (isPayload ? rawThesis.strategy : 'non_us');
    const country = pick.country || (isPayload ? rawThesis.country : 'Unknown');
    const exchange = pick.exchange || (isPayload ? rawThesis.exchange : 'Exchange');
    
    // Composite score: pick.composite_score or calculate from quant_score
    let compositeScore = pick.composite_score || (isPayload ? rawThesis.composite_score : null);
    if (!compositeScore && pick.quant_score !== undefined) {
      compositeScore = Math.round((pick.quant_score * 50) + 50);
    }
    compositeScore = compositeScore || 70;

    const fScore = isPayload ? rawThesis.fundamental_score : Math.round(compositeScore * 0.95);
    const tScore = isPayload ? rawThesis.technical_score : Math.round(compositeScore * 0.9);
    const sScore = isPayload ? rawThesis.sentiment_score : Math.round(compositeScore * 0.85);

    const summaryPoints = Array.isArray(rawThesis) 
      ? rawThesis 
      : (dossier.investment_thesis || rawThesis.points || [
          "Strong cash generation and robust operational moat.",
          "Hedges portfolio concentration away from domestic large-cap tech."
        ]);

    return {
      dossier,
      fundamentals,
      technicals,
      sentiment,
      strategy,
      country,
      exchange,
      compositeScore,
      fScore,
      tScore,
      sScore,
      summaryPoints
    };
  };

  const displayedPicks = useMemo(() => {
    const seenIdentities = new Set();
    const seenNames = new Set();
    const result = [];

    const CROSS_LIST_MAP = {
      'BATS': 'BTI', 'BTI': 'BTI',
      'NOVO-B': 'NVO', 'NVO': 'NVO',
      'ATCO-A': 'ATCO', 'ATCO-B': 'ATCO',
      'VOLV-A': 'VOLV', 'VOLV-B': 'VOLV',
      'SAN': 'SNY', 'SNY': 'SNY',
      'NESN': 'NSRGY', 'NOVN': 'NVS', 'ROG': 'RHHBY', 'ULVR': 'UL'
    };

    for (const pick of discoveryPicks) {
      const details = extractPickDetails(pick);

      // Strict strategy filter: pick must match the active strategy
      if (selectedStrategy && selectedStrategy !== 'all' && details.strategy !== selectedStrategy) {
        continue;
      }

      // Strict regionality filter: non-US strategy or region must exclude US assets
      const isNonUs = selectedStrategy === 'non_us' || regionPref === 'global_ex_us' || regionPref === 'europe_uk' || regionPref === 'asia_pacific';
      if (isNonUs && (details.country === 'United States' || details.country === 'USA' || details.country === 'US')) {
        continue;
      }

      // Deduplication by canonical base symbol and clean company name
      const sym = pick.symbol || '';
      const baseSym = sym.split('.')[0].toUpperCase();
      const canonBase = CROSS_LIST_MAP[baseSym] || baseSym;
      const cleanName = (pick.company_name || '')
        .toLowerCase()
        .replace(/[\s\.\,\-]+(plc|inc|corp|corporation|ltd|ag|se|sa|nv|holdings|group|a\/s|ab|ord|company|the|limited|- new york|adr).*$/, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10);

      if (seenIdentities.has(canonBase) || (cleanName && seenNames.has(cleanName))) {
        continue;
      }
      seenIdentities.add(canonBase);
      if (cleanName) seenNames.add(cleanName);
      result.push(pick);
    }

    return result;
  }, [discoveryPicks, selectedStrategy, regionPref]);

  return (
    <div className="dashboard-container" style={{ paddingBottom: '3rem' }}>
      
      {/* Top Header & Navigation Tabs */}
      <div className="glass-panel" style={{ padding: '1.5rem 2rem', marginBottom: '1.5rem', borderTop: '4px solid var(--accent-blue)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0, color: 'var(--text-primary)', fontSize: '1.75rem' }}>
              <Target size={28} color="var(--accent-blue)" /> 
              Global Discovery & Research Engine
            </h2>
            <p style={{ margin: '0.4rem 0 0', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Institutional-grade multi-pillar screening across international markets, hidden gems, and thematic strategies.
            </p>
          </div>

          {/* Navigation Tab Toggle */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '10px', border: '1px solid var(--panel-border)' }}>
            <button
              onClick={() => setActiveTab('discover')}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: activeTab === 'discover' ? 'var(--accent-blue)' : 'transparent',
                color: activeTab === 'discover' ? 'white' : 'var(--text-secondary)',
                border: 'none', padding: '0.55rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem'
              }}
            >
              <Search size={16} /> Discovery Engine
            </button>
            <button
              onClick={() => setActiveTab('watchlist')}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: activeTab === 'watchlist' ? 'var(--accent-blue)' : 'transparent',
                color: activeTab === 'watchlist' ? 'white' : 'var(--text-secondary)',
                border: 'none', padding: '0.55rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem'
              }}
            >
              <Bookmark size={16} /> My Watchlist ({watchlist.length})
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: DISCOVERY ENGINE */}
      {/* ===================================================================== */}
      {activeTab === 'discover' && (
        <>
          {/* Strategy Selection Cards */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                1. Select Research Strategy
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Targeting specific market inefficiencies & portfolio gaps
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
              {STRATEGIES.map(strat => {
                const IconComponent = strat.icon;
                const isSelected = selectedStrategy === strat.id;
                return (
                  <div
                    key={strat.id}
                    onClick={() => handleSelectStrategy(strat.id)}
                    style={{
                      background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.03)',
                      border: isSelected ? `2px solid ${strat.color}` : '1px solid var(--panel-border)',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative',
                      boxShadow: isSelected ? `0 0 15px rgba(59, 130, 246, 0.2)` : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div style={{
                        background: isSelected ? strat.color : 'rgba(255,255,255,0.08)',
                        width: '38px', height: '38px', borderRadius: '8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <IconComponent size={20} color={isSelected ? '#ffffff' : strat.color} />
                      </div>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600, padding: '3px 8px', borderRadius: '12px',
                        background: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)'
                      }}>
                        {strat.badge}
                      </span>
                    </div>
                    <h4 style={{ margin: '0 0 0.4rem', fontSize: '1rem', color: isSelected ? 'white' : 'var(--text-primary)' }}>
                      {strat.title}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {strat.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Research Preferences & Control Strip */}
          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '2rem', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
              
              {/* Filter Controls */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                
                {/* Market Cap Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Market Cap Focus
                  </label>
                  <select
                    value={marketCapTier}
                    onChange={e => setMarketCapTier(e.target.value)}
                    style={{
                      background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border)',
                      color: 'white', padding: '0.45rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem'
                    }}
                  >
                    <option value="all">All Market Caps</option>
                    <option value="hidden_gems">Hidden Gems / Mid-Caps ($500M - $25B)</option>
                    <option value="large_cap">Large Caps ($12B+ reasonable value)</option>
                  </select>
                </div>

                {/* Region Focus */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Geographic Region
                  </label>
                  <select
                    value={regionPref}
                    onChange={e => setRegionPref(e.target.value)}
                    style={{
                      background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border)',
                      color: 'white', padding: '0.45rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem'
                    }}
                  >
                    <option value="all">Global (All Regions)</option>
                    <option value="global_ex_us">Non-US Only (Ex-United States)</option>
                    <option value="europe_uk">Europe & United Kingdom</option>
                    <option value="asia_pacific">Asia-Pacific & Japan</option>
                  </select>
                </div>

                {/* Listing Type / Broker Accessibility */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Listing Accessibility
                  </label>
                  <select
                    value={listingType}
                    onChange={e => setListingType(e.target.value)}
                    style={{
                      background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border)',
                      color: 'white', padding: '0.45rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem'
                    }}
                  >
                    <option value="hybrid">Hybrid (ADRs + Direct Foreign Listings)</option>
                    <option value="adrs_only">US-Listed ADRs (Zero FX Fees / Standard Broker)</option>
                    <option value="direct_only">Direct Local Exchanges (.L, .DE, .TO, etc.)</option>
                  </select>
                </div>

                {/* Strict Quality Gate Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.1rem' }}>
                  <input
                    type="checkbox"
                    id="healthFilter"
                    checked={strictHealth}
                    onChange={e => setStrictHealth(e.target.checked)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <label htmlFor="healthFilter" style={{ fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Shield size={14} color="var(--accent-green)" /> Strict Health Gate (Positive FCF & Sane P/E)
                  </label>
                </div>

              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  onClick={fetchDiscoveryPicks}
                  className="btn btn-secondary"
                  title="Refresh saved picks"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--panel-border)',
                    color: 'white', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                  }}
                >
                  <RefreshCw size={15} /> Refresh
                </button>
                <button
                  onClick={handleRunDiscovery}
                  disabled={isDiscovering}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: isDiscovering ? 'rgba(59, 130, 246, 0.5)' : 'var(--accent-blue)',
                    color: 'white', padding: '0.6rem 1.4rem', borderRadius: '8px', border: 'none',
                    cursor: isDiscovering ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.9rem',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                  }}
                >
                  {isDiscovering ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Analyzing ({elapsedTime}s)...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> Run Global Discovery
                    </>
                  )}
                </button>
              </div>

            </div>

            {/* Live Active Progress Indicator */}
            {isDiscovering && (
              <div style={{
                marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: 'var(--accent-blue)',
                    boxShadow: '0 0 8px var(--accent-blue)'
                  }} />
                  <span style={{ fontSize: '0.9rem', color: 'white', fontWeight: 500 }}>
                    {discoveryStage}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  Running multi-pillar audit across 60+ candidates. This typically takes 30-50s.
                </div>
              </div>
            )}
          </div>

          {/* Section: Discovered Opportunities */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: 600 }}>
              Top Discovery Recommendations
            </h3>
            {dataFetchedAt && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Last updated: {new Date(dataFetchedAt).toLocaleString()}
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Loading discovery picks...
            </div>
          ) : displayedPicks && displayedPicks.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
              {displayedPicks.map(pick => {
                const details = extractPickDetails(pick);
                const isWatchlisted = isSymbolInWatchlist(pick.symbol);

                return (
                  <div
                    key={pick.id || pick.symbol}
                    className="glass-panel"
                    style={{
                      padding: '1.5rem', borderRadius: '14px', border: '1px solid var(--panel-border)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                      transition: 'transform 0.2s ease, border-color 0.2s ease'
                    }}
                  >
                    <div>
                      {/* Card Header: Symbol, Name, Badges & Watchlist Action */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <h4 style={{ fontSize: '1.35rem', margin: 0, color: 'white', fontWeight: 700 }}>
                              {pick.symbol}
                            </h4>
                            <span style={{
                              fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px',
                              background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', fontWeight: 600
                            }}>
                              {details.country}
                            </span>
                            <span style={{
                              fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px',
                              background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', fontWeight: 600
                            }}>
                              {details.strategy.toUpperCase().replace('_', ' ')}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                            {pick.company_name} • <span style={{ color: 'white' }}>{pick.sector}</span>
                          </div>
                        </div>

                        {/* Top Right: Composite Score & Watchlist Button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <button
                            onClick={() => handleToggleWatchlist(pick)}
                            title={isWatchlisted ? "Remove from Watchlist" : "Save to Watchlist"}
                            style={{
                              background: isWatchlisted ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.06)',
                              border: isWatchlisted ? '1px solid #f59e0b' : '1px solid var(--panel-border)',
                              color: isWatchlisted ? '#f59e0b' : 'var(--text-secondary)',
                              width: '36px', height: '36px', borderRadius: '8px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer'
                            }}
                          >
                            {isWatchlisted ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                          </button>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{
                              fontSize: '1.4rem', fontWeight: 800,
                              color: getScoreColor(details.compositeScore)
                            }}>
                              {details.compositeScore}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                              Score / 100
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Multi-Pillar Sub-Score Gauges */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem',
                        background: 'rgba(0,0,0,0.25)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem'
                      }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Fundamentals</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: getScoreColor(details.fScore) }}>
                            {details.fScore}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.06)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Technicals</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: getScoreColor(details.tScore) }}>
                            {details.tScore}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Sentiment</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: getScoreColor(details.sScore) }}>
                            {details.sScore}
                          </div>
                        </div>
                      </div>

                      {/* Quick Metrics Strip */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem',
                        borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)',
                        padding: '0.65rem 0', marginBottom: '1rem', fontSize: '0.8rem'
                      }}>
                        <div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>P/E Ratio</div>
                          <div style={{ fontWeight: 600, color: 'white' }}>
                            {details.fundamentals.trailing_pe ? details.fundamentals.trailing_pe.toFixed(1) : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Free Cash Flow</div>
                          <div style={{ fontWeight: 600, color: 'white' }}>
                            {formatMcap(details.fundamentals.free_cashflow)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Div Yield</div>
                          <div style={{ fontWeight: 600, color: 'white' }}>
                            {formatPct(details.fundamentals.dividend_yield)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Beta</div>
                          <div style={{ fontWeight: 600, color: 'white' }}>
                            {details.fundamentals.beta ? details.fundamentals.beta.toFixed(2) : 'N/A'}
                          </div>
                        </div>
                      </div>

                      {/* Investment Thesis Highlights */}
                      <div style={{ marginBottom: '1rem' }}>
                        <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                          Investment Thesis Highlights
                        </strong>
                        <ul style={{ paddingLeft: '1.1rem', margin: 0, fontSize: '0.88rem', lineHeight: 1.45, color: 'var(--text-primary)' }}>
                          {details.summaryPoints.slice(0, 2).map((pt, idx) => (
                            <li key={idx} style={{ marginBottom: '0.35rem' }}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Footer Button: Open Full Institutional Dossier */}
                    <button
                      onClick={() => { setSelectedPick(pick); setModalTab('thesis'); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid var(--panel-border)',
                        color: 'white', padding: '0.65rem 1rem', borderRadius: '8px', cursor: 'pointer',
                        fontWeight: 600, fontSize: '0.88rem', transition: 'background 0.2s ease'
                      }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
                      onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                    >
                      View Deep Analysis Dossier <ChevronRight size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
              No current recommendations found for {STRATEGIES.find(s => s.id === selectedStrategy)?.title || 'this strategy'}. Click "Run Global Discovery" above to screen and analyze top candidates!
            </div>
          )}
        </>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: WATCHLIST VIEW */}
      {/* ===================================================================== */}
      {activeTab === 'watchlist' && (
        <div className="glass-panel" style={{ padding: '1.5rem 2rem', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.3rem', color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bookmark size={20} color="#f59e0b" /> Tracked Watchlist
              </h3>
              <p style={{ margin: '0.3rem 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Overlooked gems and candidates saved for active monitoring and execution.
              </p>
            </div>
            <button
              onClick={fetchWatchlist}
              className="btn btn-secondary"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'rgba(255,255,255,0.08)', border: '1px solid var(--panel-border)',
                color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer'
              }}
            >
              <RefreshCw size={15} /> Refresh Watchlist
            </button>
          </div>

          {watchlistLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading watchlist...</div>
          ) : watchlist && watchlist.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Symbol</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Company</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Sector</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Country</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Source Strategy</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Date Added</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map(item => (
                    <tr 
                      key={item.symbol} 
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s ease' }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '1rem', fontWeight: 700, color: 'white' }}>
                        {item.symbol}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                        {item.company_name}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                        {item.sector}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                        {item.country || 'Global'}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{
                          fontSize: '0.75rem', padding: '3px 8px', borderRadius: '12px',
                          background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', fontWeight: 600
                        }}>
                          {(item.added_from || 'discovery').toUpperCase().replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Recent'}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleRemoveFromWatchlist(item.symbol)}
                            title="Remove from watchlist"
                            style={{
                              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: 'var(--accent-red)', padding: '0.4rem 0.6rem', borderRadius: '6px', cursor: 'pointer'
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              No stocks in watchlist yet. Click the bookmark icon on any discovered stock to save it here!
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* DEEP ANALYSIS DOSSIER MODAL */}
      {/* ===================================================================== */}
      {selectedPick && (() => {
        const details = extractPickDetails(selectedPick);
        const dossier = details.dossier || {};
        const isWatchlisted = isSymbolInWatchlist(selectedPick.symbol);

        return (
          <Modal isOpen={!!selectedPick} onClose={() => setSelectedPick(null)}>
            <div style={{ padding: '1.5rem', maxWidth: '850px', margin: '0 auto', color: 'var(--text-primary)' }}>
              
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <h3 style={{ fontSize: '1.75rem', margin: 0, color: 'white', fontWeight: 700 }}>
                      {selectedPick.symbol}
                    </h3>
                    <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                      {details.country} ({details.exchange})
                    </span>
                    <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-blue)', fontWeight: 600 }}>
                      {details.strategy.toUpperCase().replace('_', ' ')}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                    {selectedPick.company_name} • {selectedPick.sector}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <button
                    onClick={() => handleToggleWatchlist(selectedPick)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                      background: isWatchlisted ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.08)',
                      border: isWatchlisted ? '1px solid #f59e0b' : '1px solid var(--panel-border)',
                      color: isWatchlisted ? '#f59e0b' : 'white', padding: '0.5rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                  >
                    {isWatchlisted ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                    {isWatchlisted ? 'In Watchlist' : 'Save to Watchlist'}
                  </button>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: getScoreColor(details.compositeScore) }}>
                      {details.compositeScore}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>COMPOSITE SCORE</div>
                  </div>
                </div>
              </div>

              {/* Dossier Navigation Tabs */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
                {[
                  { id: 'thesis', label: 'Hidden Gem Thesis', icon: Sparkles },
                  { id: 'fundamentals', label: 'Financial Health', icon: BarChart3 },
                  { id: 'technicals', label: 'Quant Technicals', icon: TrendingUp },
                  { id: 'sentiment', label: 'Sentiment & Catalysts', icon: Newspaper },
                  { id: 'risks', label: 'Critical Bear Case', icon: AlertTriangle }
                ].map(t => {
                  const Icon = t.icon;
                  const isActive = modalTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setModalTab(t.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                        border: 'none', borderBottom: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                        color: isActive ? 'white' : 'var(--text-secondary)',
                        padding: '0.5rem 0.8rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'
                      }}
                    >
                      <Icon size={15} color={isActive ? 'var(--accent-blue)' : 'var(--text-secondary)'} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab 1: Hidden Gem Thesis */}
              {modalTab === 'thesis' && (
                <div>
                  {dossier.hidden_gem_factor && (
                    <div style={{
                      background: 'rgba(59, 130, 246, 0.08)', borderLeft: '4px solid var(--accent-blue)',
                      padding: '1rem', borderRadius: '4px', marginBottom: '1.25rem'
                    }}>
                      <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--accent-blue)', fontSize: '0.9rem' }}>
                        The Hidden Gem Angle
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.55 }}>
                        {dossier.hidden_gem_factor}
                      </p>
                    </div>
                  )}

                  <h4 style={{ fontSize: '1rem', color: 'white', marginBottom: '0.6rem' }}>Core Investment Pillars</h4>
                  <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1.25rem 0', fontSize: '0.92rem', lineHeight: 1.6 }}>
                    {(dossier.investment_thesis || details.summaryPoints).map((point, idx) => (
                      <li key={idx} style={{ marginBottom: '0.5rem' }}>{point}</li>
                    ))}
                  </ul>

                  {dossier.portfolio_synergy && (
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '0.3rem', color: 'var(--accent-green)', fontSize: '0.88rem' }}>
                        Portfolio Fit & Risk Reduction
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                        {dossier.portfolio_synergy}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Financial Health & Fundamentals */}
              {modalTab === 'fundamentals' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Market Cap</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{formatMcap(details.fundamentals.market_cap)}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Trailing P/E</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{details.fundamentals.trailing_pe ? details.fundamentals.trailing_pe.toFixed(2) : 'N/A'}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Free Cash Flow</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-green)' }}>{formatMcap(details.fundamentals.free_cashflow)}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Debt to Equity</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{details.fundamentals.debt_to_equity ? details.fundamentals.debt_to_equity.toFixed(1) : 'N/A'}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Dividend Yield</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{formatPct(details.fundamentals.dividend_yield)}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Operating Margin</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{formatPct(details.fundamentals.operating_margin)}</div>
                    </div>
                  </div>

                  {dossier.financial_health_summary && (
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'white', fontSize: '0.9rem' }}>
                        Financial Health Audit
                      </strong>
                      <ul style={{ paddingLeft: '1.2rem', margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                        {dossier.financial_health_summary.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: '0.35rem' }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Quant Technicals */}
              {modalTab === 'technicals' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Daily Momentum</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                        {details.technicals.daily_score ? details.technicals.daily_score.toFixed(2) : '0.00'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Weekly Momentum</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                        {details.technicals.weekly_score ? details.technicals.weekly_score.toFixed(2) : '0.00'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Beta vs S&P 500</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                        {details.fundamentals.beta ? details.fundamentals.beta.toFixed(2) : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {dossier.technical_timing && (
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <strong style={{ display: 'block', marginBottom: '0.3rem', color: 'var(--accent-blue)', fontSize: '0.88rem' }}>
                        Timing & Entry Assessment
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                        {dossier.technical_timing}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Sentiment & Catalysts */}
              {modalTab === 'sentiment' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Analyst Target</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                        {details.sentiment.analyst_target ? `$${details.sentiment.analyst_target}` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Implied Upside</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                        {details.sentiment.upside_pct ? `+${details.sentiment.upside_pct}%` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Consensus Rating</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', textTransform: 'capitalize' }}>
                        {details.sentiment.recommendation || 'Hold'}
                      </div>
                    </div>
                  </div>

                  <h4 style={{ fontSize: '1rem', color: 'white', marginBottom: '0.75rem' }}>Recent Headlines & News Sentiment</h4>
                  {details.sentiment.recent_headlines && details.sentiment.recent_headlines.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {details.sentiment.recent_headlines.map((hl, idx) => (
                        <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'white', marginBottom: '2px' }}>{hl.headline}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Source: {hl.source} • {hl.impact}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>No recent headlines logged.</div>
                  )}
                </div>
              )}

              {/* Tab 5: Critical Bear Case & Risks */}
              {modalTab === 'risks' && (
                <div>
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.08)', borderLeft: '4px solid var(--accent-red)',
                    padding: '1rem', borderRadius: '4px', marginBottom: '1rem'
                  }}>
                    <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--accent-red)', fontSize: '0.9rem' }}>
                      Objective Downside Risk Assessment
                    </strong>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Per institutional due diligence guidelines, critical risks (FX currency headwinds, regulatory scrutiny, macro headwinds, and valuation multiples) must be weighed honestly before allocating capital.
                    </p>
                  </div>

                  <ul style={{ paddingLeft: '1.2rem', margin: 0, fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                    {(dossier.bear_case || [
                      "Macroeconomic deceleration impacting discretionary volume and order flow.",
                      "Foreign exchange (FX) currency fluctuations vs USD or domestic inflation pressures."
                    ]).map((risk, idx) => (
                      <li key={idx} style={{ marginBottom: '0.5rem' }}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          </Modal>
        );
      })()}

    </div>
  );
};

export default Discover;
