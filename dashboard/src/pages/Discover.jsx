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

const MARKETS = [
  { id: 'usa', label: 'USA (S&P 1500 & Alpaca)', flag: '🇺🇸', desc: 'S&P 500 Large + S&P 400 MidCap + Alpaca Tradables (~5,500 stocks)' },
  { id: 'uk', label: 'United Kingdom (FTSE 350)', flag: '🇬🇧', desc: 'FTSE 100 Blue Chips + FTSE 250 MidCaps (~350 stocks)' },
  { id: 'europe', label: 'Continental Europe (STOXX 600)', flag: '🇪🇺', desc: 'Pan-European champions across Germany, France, Switzerland, Nordics (~460 stocks)' },
  { id: 'japan', label: 'Japan (Nikkei 225 & TSE Prime)', flag: '🇯🇵', desc: 'Tokyo Stock Exchange cash-rich leaders & innovators (~100 stocks)' },
  { id: 'global', label: 'Global International Leaders', flag: '🌐', desc: 'Diversified non-US compounders, Canada, Australia & liquid ADRs' },
];

const Discover = () => {
  const [activeTab, setActiveTab] = useState('discover'); // 'discover' | 'watchlist'
  const [selectedStrategy, setSelectedStrategy] = useState('value');
  const [selectedMarket, setSelectedMarket] = useState('usa');
  const [marketCapTier, setMarketCapTier] = useState('all'); // 'hidden_gems' | 'large_cap' | 'all'
  const [regionPref, setRegionPref] = useState('all'); // 'global_ex_us' | 'europe_uk' | 'asia_pacific' | 'all'
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

  // Top 20 Contenders Modal state
  const [showContendersModal, setShowContendersModal] = useState(false);
  const [contendersData, setContendersData] = useState({ contenders: [], contender_matrix: [] });
  const [contendersLoading, setContendersLoading] = useState(false);

  // Deep Analysis Modal state
  const [selectedPick, setSelectedPick] = useState(null);
  const [modalTab, setModalTab] = useState('thesis'); // 'thesis' | 'fundamentals' | 'technicals' | 'sentiment' | 'risks'


  const apiUrl = import.meta.env.VITE_API_URL || '';

  const handleSelectStrategy = (stratId) => {
    setSelectedStrategy(stratId);
    if (stratId === 'non_us') {
      setRegionPref('global_ex_us');
    } else if (regionPref === 'global_ex_us') {
      setRegionPref('all');
    }
  };

  // ---------------------------------------------------------------------------
  // FETCH PICKS & WATCHLIST
  // ---------------------------------------------------------------------------
  const fetchDiscoveryPicks = async (strat) => {
    setLoading(true);
    try {
      setDataFetchedAt(new Date().toISOString());
      // Safely ensure targetStrat is a valid string, not an event object or undefined
      const targetStrat = (typeof strat === 'string' && strat.trim()) ? strat.trim() : selectedStrategy;
      const queryParam = targetStrat && targetStrat !== 'all' ? `&strategy=${encodeURIComponent(targetStrat)}` : '';
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

  const fetchContenders = async () => {
    setContendersLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/discovery-contenders`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setContendersData(json.data);
        }
      }
    } catch (err) {
      console.error("Error fetching discovery contenders:", err);
    }
    setContendersLoading(false);
  };

  useEffect(() => {
    fetchDiscoveryPicks(selectedStrategy);
  }, [selectedStrategy]);

  useEffect(() => {
    fetchWatchlist();
    fetchContenders();
  }, []);

  // ---------------------------------------------------------------------------
  // RUN 4-STAGE DISCOVERY FUNNEL & PROGRESS POLLING
  // ---------------------------------------------------------------------------
  const handleRunDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryStage(`Stage 1: Ingesting ${selectedMarket.toUpperCase()} Universe & Pre-Flight Gate...`);
    setElapsedTime(0);

    try {
      const res = await fetch(`${apiUrl}/api/run-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: selectedStrategy,
          market: selectedMarket,
          market_cap_tier: marketCapTier,
          region_preference: regionPref,
          listing_type: listingType,
          strict_health_filter: strictHealth,
          target_contenders: 20
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
            fetchContenders();
          }
        }
      } catch (err) {
        console.error("Poll status error:", err);
      }
    }, 3000);

    // Timeout safety after 180 seconds
    setTimeout(() => {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
      setIsDiscovering(false);
      fetchDiscoveryPicks(selectedStrategy);
      fetchContenders();
    }, 180000);
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
    const rank = pick.rank || (isPayload ? rawThesis.rank : null);
    const tournamentEdge = dossier.tournament_edge || null;
    const insiderScore = isPayload ? rawThesis.insider_score : (pick.insider_score || 50);

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
      insiderScore,
      rank,
      tournamentEdge,
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

      // Strict regionality filter: non-US strategy must strictly exclude US domestic assets
      if (selectedStrategy === 'non_us' && (details.country === 'United States' || details.country === 'USA' || details.country === 'US')) {
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

          {/* 2. Select Target Market Universe */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                2. Select Target Market Universe
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Scanning entire institutional index constituents with pre-flight liquidity gating
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
              {MARKETS.map(m => {
                const isSelected = selectedMarket === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedMarket(m.id)}
                    style={{
                      background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: isSelected ? '2px solid var(--accent-blue)' : '1px solid var(--panel-border)',
                      borderRadius: '10px',
                      padding: '0.9rem 1rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isSelected ? '0 0 12px rgba(59, 130, 246, 0.25)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>{m.flag}</span>
                      <strong style={{ fontSize: '0.9rem', color: isSelected ? 'white' : 'var(--text-primary)' }}>
                        {m.label}
                      </strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      {m.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Research Preferences & Funnel Control Strip */}
          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '2rem', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
              
              {/* Quality & Pre-Flight Gating Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{
                  fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent-green)',
                  border: '1px solid rgba(16, 185, 129, 0.3)', padding: '4px 10px', borderRadius: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px'
                }}>
                  <Shield size={13} /> Liquidity Floor: &gt;$10M/day
                </span>
                <span style={{
                  fontSize: '0.78rem', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--accent-blue)',
                  border: '1px solid rgba(59, 130, 246, 0.3)', padding: '4px 10px', borderRadius: '16px', fontWeight: 600
                }}>
                  Price Floor: &gt;$5.00 (No Pennies)
                </span>
                <span style={{
                  fontSize: '0.78rem', background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b',
                  border: '1px solid rgba(245, 158, 11, 0.3)', padding: '4px 10px', borderRadius: '16px', fontWeight: 600
                }}>
                  Exclusions: SPACs / Zombie Debt / Micro-caps
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { fetchContenders(); setShowContendersModal(true); }}
                  className="btn btn-secondary"
                  title="View full list of audited contenders and elimination reasons"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--panel-border)',
                    color: 'white', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                  }}
                >
                  <Layers size={15} color="var(--accent-blue)" /> Top 20 Contenders Matrix
                </button>

                <button
                  onClick={() => fetchDiscoveryPicks(selectedStrategy)}
                  disabled={loading || isDiscovering}
                  className="btn btn-secondary"
                  title="Refresh saved picks"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--panel-border)',
                    color: 'white', padding: '0.6rem 1rem', borderRadius: '8px', cursor: (loading || isDiscovering) ? 'not-allowed' : 'pointer', fontSize: '0.85rem'
                  }}
                >
                  <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {loading ? "Refreshing..." : "Refresh"}
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
                      <RefreshCw size={16} className="animate-spin" /> Funnel Running ({elapsedTime}s)...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> Run 4-Stage Discovery
                    </>
                  )}
                </button>
              </div>

            </div>

            {/* Live 4-Stage Funnel Visualizer */}
            {isDiscovering && (
              <div style={{
                marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: 'var(--accent-blue)',
                      boxShadow: '0 0 10px var(--accent-blue)'
                    }} />
                    <span style={{ fontSize: '0.92rem', color: 'white', fontWeight: 600 }}>
                      {discoveryStage}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    Funnel Elapsed: <strong style={{ color: 'white' }}>{elapsedTime}s</strong>
                  </span>
                </div>

                {/* 4-Step Pipeline Stepper */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                  {[
                    { step: 1, title: '1. Pre-Flight Gate', desc: 'Scan market & exclude penny/illiquid/SPACs' },
                    { step: 2, title: '2. Strategy Pre-Score', desc: 'Multi-factor rank down to Top 20' },
                    { step: 3, title: '3. Deep Research Audit', desc: 'Quant, Form 4 Insiders, Tier 1 News, Macro' },
                    { step: 4, title: '4. Gemini 3.8 Tournament', desc: 'Comparative AI synthesis & Crown Top 5' }
                  ].map(s => {
                    const isCurrent = discoveryStage.includes(`Stage ${s.step}`);
                    const isPast = (s.step === 1 && (discoveryStage.includes('Stage 2') || discoveryStage.includes('Stage 3') || discoveryStage.includes('Stage 4') || discoveryStage.includes('Complete'))) ||
                                   (s.step === 2 && (discoveryStage.includes('Stage 3') || discoveryStage.includes('Stage 4') || discoveryStage.includes('Complete'))) ||
                                   (s.step === 3 && (discoveryStage.includes('Stage 4') || discoveryStage.includes('Complete')));

                    return (
                      <div key={s.step} style={{
                        background: isCurrent ? 'rgba(59, 130, 246, 0.18)' : isPast ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.02)',
                        border: isCurrent ? '1px solid var(--accent-blue)' : isPast ? '1px solid var(--accent-green)' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px', padding: '0.65rem 0.8rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                          {isPast ? <CheckCircle2 size={14} color="var(--accent-green)" /> : <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: isCurrent ? 'var(--accent-blue)' : 'var(--text-secondary)' }} />}
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isCurrent ? 'white' : isPast ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                            {s.title}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                          {s.desc}
                        </div>
                      </div>
                    );
                  })}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                            <h4 style={{ fontSize: '1.35rem', margin: 0, color: 'white', fontWeight: 700 }}>
                              {pick.symbol}
                            </h4>
                            {details.rank && (
                              <span style={{
                                fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px',
                                background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', fontWeight: 700, border: '1px solid rgba(245, 158, 11, 0.4)'
                              }}>
                                #{details.rank} Pick
                              </span>
                            )}
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
                          {details.tournamentEdge && (
                            <div style={{
                              marginTop: '0.4rem', background: 'rgba(59, 130, 246, 0.12)', borderLeft: '3px solid var(--accent-blue)',
                              padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', color: '#93c5fd'
                            }}>
                              <strong style={{ color: 'white' }}>Tournament Edge:</strong> {details.tournamentEdge}
                            </div>
                          )}
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
              onClick={() => fetchWatchlist()}
              disabled={watchlistLoading}
              className="btn btn-secondary"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'rgba(255,255,255,0.08)', border: '1px solid var(--panel-border)',
                color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', cursor: watchlistLoading ? 'not-allowed' : 'pointer'
              }}
            >
              <RefreshCw size={15} className={watchlistLoading ? "animate-spin" : ""} /> {watchlistLoading ? "Refreshing..." : "Refresh Watchlist"}
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

      {/* ===================================================================== */}
      {/* MODAL: TOP CONTENDERS & ELIMINATION MATRIX */}
      {/* ===================================================================== */}
      <Modal isOpen={showContendersModal} onClose={() => setShowContendersModal(false)}>
        <div style={{ padding: '1.5rem', maxWidth: '1050px', margin: '0 auto', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.5rem', margin: 0, color: 'white', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Layers size={22} color="var(--accent-blue)" /> Top Contenders & Elimination Matrix
              </h3>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Full cross-market contenders that cleared the pre-flight gate, ranked by the quantitative screener and audited by Gemini 3.8 Flash.
              </p>
            </div>
            {contendersData.last_updated && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', alignSelf: 'center' }}>
                Audited: {new Date(contendersData.last_updated).toLocaleString()}
              </span>
            )}
          </div>

          {contendersLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.5rem', display: 'block' }} />
              Loading contenders matrix...
            </div>
          ) : !contendersData.contenders || contendersData.contenders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              No contenders data found. Run the 4-stage discovery funnel to audit candidates and populate the matrix.
            </div>
          ) : (
            <div>
              {/* Matrix Table */}
              <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Rank / Status</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Asset</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Sector</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Composite</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Fund / Tech / Sent</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Tournament Outcome / Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contendersData.contenders.map((c, idx) => {
                      const isWinner = idx < 5;
                      const matrixItem = (contendersData.contender_matrix || []).find(m => m.symbol === c.symbol);
                      const exclusionReason = matrixItem?.exclusion_reason || (isWinner ? 'Crowned Top 5 Winner with complete institutional research dossier.' : 'Ranked below Top 5 cutoff based on lower composite margin/FCF yield.');

                      return (
                        <tr
                          key={c.symbol || idx}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: isWinner ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                            transition: 'background 0.2s'
                          }}
                        >
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                            {isWinner ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-green)',
                                padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700
                              }}>
                                <CheckCircle2 size={12} /> Top 5 Winner (#{idx + 1})
                              </span>
                            ) : (
                              <span style={{
                                color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)',
                                padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem'
                              }}>
                                Contender #{idx + 1}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: 700, color: 'white' }}>{c.symbol}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{c.company_name}</div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {c.sector} • <span style={{ color: 'white' }}>{c.country}</span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <span style={{
                              fontWeight: 800, fontSize: '0.95rem',
                              color: getScoreColor(c.composite_score)
                            }}>
                              {c.composite_score ? c.composite_score.toFixed(1) : (c.pre_score ? c.pre_score.toFixed(1) : 'N/A')}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.8rem' }}>
                            <span style={{ color: getScoreColor(c.fundamental_score) }}>{c.fundamental_score ? Math.round(c.fundamental_score) : '-'}</span>
                            <span style={{ color: 'var(--text-secondary)', margin: '0 4px' }}>/</span>
                            <span style={{ color: getScoreColor(c.technical_score) }}>{c.technical_score ? Math.round(c.technical_score) : '-'}</span>
                            <span style={{ color: 'var(--text-secondary)', margin: '0 4px' }}>/</span>
                            <span style={{ color: getScoreColor(c.sentiment_score) }}>{c.sentiment_score ? Math.round(c.sentiment_score) : '-'}</span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: isWinner ? 'var(--accent-green)' : 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {exclusionReason}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
};

export default Discover;
