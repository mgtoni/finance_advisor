import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { PlusCircle, Save } from 'lucide-react';

const PortfolioManager = () => {
  const [symbol, setSymbol] = useState('');
  const [openDate, setOpenDate] = useState(new Date().toISOString().split('T')[0]);
  const [shares, setShares] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  
  const [status, setStatus] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      const symbolUpper = symbol.toUpperCase().trim();

      // 1. Ensure ticker exists in master list
      const { error: tickerError } = await supabase
        .from('tickers')
        .upsert({ symbol: symbolUpper }, { onConflict: 'symbol' });

      if (tickerError) throw tickerError;

      // 2. Insert the position
      const positionData = {
        symbol: symbolUpper,
        open_date: openDate,
        shares: parseFloat(shares),
        entry_price: parseFloat(entryPrice)
      };

      const { error: positionError } = await supabase
        .from('positions')
        .insert(positionData);

      if (positionError) throw positionError;

      setStatus({ type: 'success', message: `Successfully saved ${symbolUpper}!` });
      // Clear form
      setSymbol('');
      setShares('');
      setEntryPrice('');
      
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to save holding.' });
    } finally {
      setLoading(false);
    }
  };

  const [analysisLoading, setAnalysisLoading] = useState(false);

  const handleRunAnalysis = async () => {
    setAnalysisLoading(true);
    setStatus({ type: '', message: '' });
    
    try {
      // Allow overriding API URL for production
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${apiUrl}/api/run-analysis`, {
        method: 'POST'
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Analysis failed');
      
      setStatus({ type: 'success', message: 'Analysis completed! Check your dashboard.' });
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to trigger backend. Ensure the Python API server is running.' });
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="dashboard-grid">
      <div className="glass-panel" style={{ gridColumn: '1 / -1', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlusCircle size={24} color="var(--accent-blue)" />
          Add / Update Holding
        </h2>
        
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Input your portfolio positions here. The backend AI engine will automatically detect these stocks and generate daily quantitative analysis for them.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Ticker Symbol</label>
            <input 
              type="text" 
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. AAPL"
              required
              style={{
                width: '100%', padding: '0.75rem', borderRadius: '8px',
                background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
                color: 'white', outline: 'none', textTransform: 'uppercase'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Purchase / Open Date</label>
            <input 
              type="date" 
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
              required
              style={{
                width: '100%', padding: '0.75rem', borderRadius: '8px',
                background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
                color: 'white', outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Quantity (Shares)</label>
              <input 
                type="number" 
                step="any"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="e.g. 50"
                required
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
                  color: 'white', outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Avg Entry Price ($)</label>
              <input 
                type="number" 
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="e.g. 150.25"
                required
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
                  color: 'white', outline: 'none'
                }}
              />
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            <button 
              type="submit" 
              disabled={loading || analysisLoading}
              style={{
                padding: '0.75rem', borderRadius: '8px',
                background: 'var(--accent-blue)', color: 'white', border: 'none',
                cursor: (loading || analysisLoading) ? 'not-allowed' : 'pointer', fontWeight: 600,
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem',
                opacity: (loading || analysisLoading) ? 0.7 : 1
              }}
            >
              <Save size={18} />
              {loading ? 'Saving...' : 'Save Holding'}
            </button>

            <button 
              type="button" 
              onClick={handleRunAnalysis}
              disabled={loading || analysisLoading}
              style={{
                padding: '0.75rem', borderRadius: '8px',
                background: 'transparent', color: 'white', border: '1px solid var(--accent-green)',
                cursor: (loading || analysisLoading) ? 'not-allowed' : 'pointer', fontWeight: 600,
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem',
                opacity: (loading || analysisLoading) ? 0.7 : 1
              }}
            >
              {analysisLoading ? 'Analyzing (Takes a minute)...' : 'Run Analysis Now'}
            </button>
          </div>

          {status.message && (
            <div style={{ 
              marginTop: '1rem', padding: '1rem', borderRadius: '8px', textAlign: 'center',
              background: status.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: status.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
              border: `1px solid ${status.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
            }}>
              {status.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default PortfolioManager;
