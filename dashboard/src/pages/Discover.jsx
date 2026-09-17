import React, { useState, useEffect } from 'react';
import { Target, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

const Discover = () => {
  const [discoveryPicks, setDiscoveryPicks] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchDiscoveryPicks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.table('discovery_picks').select('*').order('created_at', { ascending: false }).limit(5);
      if (!error && data) {
        setDiscoveryPicks(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDiscoveryPicks();
  }, []);

  const handleRunDiscovery = async () => {
    setIsDiscovering(true);
    const apiUrl = import.meta.env.VITE_API_URL || '';
    try {
      await fetch(`${apiUrl}/api/run-discovery`, { method: 'POST' });
      alert("AI Discovery triggered! It will calculate portfolio gaps and scrape global assets. Check back in ~60 seconds and refresh.");
    } catch(e) {
      console.error(e);
    }
    setTimeout(() => {
      setIsDiscovering(false);
      fetchDiscoveryPicks();
    }, 5000);
  };

  return (
    <div className="dashboard-container">
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderTop: '4px solid var(--accent-blue)' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
             <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'var(--text-primary)' }}>
                <Target size={24} color="var(--accent-blue)" /> 
                AI Discovery Engine
             </h3>
             <div style={{ display: 'flex', gap: '1rem' }}>
               <button onClick={fetchDiscoveryPicks} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--panel-border)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
                 <RefreshCw size={16} /> Refresh
               </button>
               <button 
                   onClick={handleRunDiscovery}
                   disabled={isDiscovering}
                   style={{
                       background: 'var(--accent-blue)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', cursor: isDiscovering ? 'not-allowed' : 'pointer', fontWeight: 'bold'
                   }}
               >
                   {isDiscovering ? 'Triggered...' : 'Run Active Discovery'}
               </button>
             </div>
         </div>
         <p className="text-muted" style={{ marginBottom: '1.5rem', fontSize: '1.1rem', lineHeight: 1.6 }}>
            The AI acts as your global screener, calculating correlation matrices on your current portfolio and finding exact global tickers to perfectly hedge your gaps. 
            When you run discovery, the AI looks for assets that provide uncorrelated returns, reducing your overall portfolio volatility while maximizing expected value.
         </p>
         
         {loading ? (
           <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading Draft Picks...</div>
         ) : discoveryPicks && discoveryPicks.length > 0 ? (
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
         ) : (
           <div style={{ textAlign: 'center', padding: '2rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
              No draft picks yet. Click "Run Active Discovery" to find new assets!
           </div>
         )}
      </div>
    </div>
  );
};

export default Discover;
