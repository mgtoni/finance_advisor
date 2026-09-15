import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PlusCircle, Save } from 'lucide-react';

const PortfolioManager = () => {
  const [symbol, setSymbol] = useState('');
  const [openDate, setOpenDate] = useState(new Date().toISOString().split('T')[0]);
  const [shares, setShares] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  
  const [status, setStatus] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState(false);

  const [positions, setPositions] = useState([]);
  const [closeInputs, setCloseInputs] = useState({});
  const [closeLoading, setCloseLoading] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ open_date: '', shares: '', entry_price: '' });
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .order('symbol')
        .order('open_date', { ascending: false });
        
      if (!error) {
        setPositions(data || []);
        const initialInputs = {};
        (data || []).forEach(p => {
          initialInputs[p.id] = p.shares;
        });
        setCloseInputs(initialInputs);
      }
    } catch (err) {
      console.error('Error fetching positions:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      const symbolUpper = symbol.toUpperCase().trim();

      // Send position to backend to handle FX conversion and DB insertion
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/add-position`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: symbolUpper,
          open_date: openDate,
          shares: parseFloat(shares),
          entry_price: parseFloat(entryPrice),
          currency: currency
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save holding');

      setStatus({ type: 'success', message: `Successfully saved ${symbolUpper}! ${data.currency !== 'USD' ? `Converted ${data.original_price} ${currency} to ${data.converted_price.toFixed(2)} USD.` : ''}` });
      // Clear form
      setSymbol('');
      setShares('');
      setEntryPrice('');
      setCurrency('USD');
      
      // Refresh positions table
      await fetchPositions();
      
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
      const apiUrl = import.meta.env.VITE_API_URL || '';
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

  const handleClosePosition = async (positionId) => {
    const sharesToClose = parseFloat(closeInputs[positionId]);
    if (isNaN(sharesToClose) || sharesToClose <= 0) return;
    
    setCloseLoading(true);
    setStatus({ type: '', message: '' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/close-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: positionId, shares_to_close: sharesToClose })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to close position');
      
      setStatus({ type: 'success', message: data.message });
      await fetchPositions();
      
      setTimeout(() => setStatus({ type: '', message: '' }), 3000);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to close position.' });
    } finally {
      setCloseLoading(false);
    }
  };

  const handleEditClick = (pos) => {
    setEditingId(pos.id);
    setEditForm({
      open_date: pos.open_date,
      shares: pos.shares,
      entry_price: pos.entry_price
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async () => {
    setEditLoading(true);
    setStatus({ type: '', message: '' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/edit-position`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: editingId,
          open_date: editForm.open_date,
          shares: editForm.shares,
          entry_price: editForm.entry_price
        })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to edit position');
      
      setStatus({ type: 'success', message: data.message });
      setEditingId(null);
      await fetchPositions();
      
      setTimeout(() => setStatus({ type: '', message: '' }), 3000);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to edit position.' });
    } finally {
      setEditLoading(false);
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
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
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Currency</label>
              <select 
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)',
                  color: 'white', outline: 'none', appearance: 'menulist'
                }}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBp">GBp (Pence)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Avg Entry Price</label>
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

      {/* Existing Positions Section */}
      <div className="glass-panel" style={{ gridColumn: '1 / -1', maxWidth: '800px', margin: '2rem auto 0', width: '100%', padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Existing Open Positions (Tax Lots)</h3>
        {positions && positions.length > 0 ? (
          <div className="table-responsive">
            <table className="portfolio-table" style={{ fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Open Date</th>
                  <th>Entry Price</th>
                  <th>Current Shares</th>
                  <th>Close Amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const isEditing = editingId === pos.id;
                  return (
                    <tr key={pos.id}>
                      <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{pos.symbol}</td>
                      
                      <td>
                        {isEditing ? (
                          <input 
                            type="date"
                            value={editForm.open_date}
                            onChange={(e) => setEditForm({ ...editForm, open_date: e.target.value })}
                            style={{ width: '130px', padding: '0.25rem', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                          />
                        ) : (
                          pos.open_date
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            $
                            <input 
                              type="number"
                              step="any"
                              value={editForm.entry_price}
                              onChange={(e) => setEditForm({ ...editForm, entry_price: e.target.value })}
                              style={{ width: '80px', padding: '0.25rem', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                            />
                          </div>
                        ) : (
                          `$${Number(pos.entry_price).toFixed(2)}`
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <input 
                            type="number"
                            step="any"
                            value={editForm.shares}
                            onChange={(e) => setEditForm({ ...editForm, shares: e.target.value })}
                            style={{ width: '80px', padding: '0.25rem', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                          />
                        ) : (
                          pos.shares
                        )}
                      </td>

                      <td>
                        {!isEditing && (
                          <input 
                            type="number"
                            step="any"
                            max={pos.shares}
                            min="0"
                            value={closeInputs[pos.id] || ''}
                            onChange={(e) => setCloseInputs({ ...closeInputs, [pos.id]: e.target.value })}
                            style={{ width: '80px', padding: '0.25rem', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                          />
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={editLoading}
                              style={{ padding: '0.25rem 0.5rem', background: 'var(--accent-green)', color: 'white', border: 'none', borderRadius: '4px', cursor: editLoading ? 'not-allowed' : 'pointer' }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              disabled={editLoading}
                              style={{ padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', cursor: editLoading ? 'not-allowed' : 'pointer' }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={() => handleEditClick(pos)}
                              style={{ padding: '0.25rem 0.5rem', background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClosePosition(pos.id)}
                              disabled={closeLoading}
                              style={{
                                padding: '0.25rem 0.5rem', background: 'var(--accent-red)', color: 'white', border: 'none', borderRadius: '4px', cursor: closeLoading ? 'not-allowed' : 'pointer', opacity: closeLoading ? 0.7 : 1
                              }}
                            >
                              Close
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>No open positions found.</p>
        )}
      </div>
    </div>
  );
};

export default PortfolioManager;
