import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Discover from './pages/Discover';
import PortfolioManager from './components/PortfolioManager';
import Auth from './components/Auth';
import { supabase } from './lib/supabase';
import { LogOut, LayoutDashboard, Settings, Target } from 'lucide-react';

function AppContent({ session, handleSignOut }) {
  const location = useLocation();

  if (!session) {
    return <Auth onAuthSuccess={() => {}} />;
  }

  return (
    <div className="app-container">
      <header className="header" style={{ alignItems: 'center' }}>
        <div>
          <h1>Quant Advisor</h1>
          <p>Automated AI Portfolio Management</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <nav style={{ display: 'flex', gap: '1rem', marginRight: '1rem' }}>
            <Link 
              to="/" 
              style={{ 
                color: location.pathname === '/' ? 'var(--text-primary)' : 'var(--text-secondary)',
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontWeight: location.pathname === '/' ? 600 : 400
              }}
            >
              <LayoutDashboard size={18} /> Dashboard
            </Link>
            <Link 
              to="/discover" 
              style={{ 
                color: location.pathname === '/discover' ? 'var(--text-primary)' : 'var(--text-secondary)',
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontWeight: location.pathname === '/discover' ? 600 : 400
              }}
            >
              <Target size={18} /> Discover
            </Link>
            <Link 
              to="/manage" 
              style={{ 
                color: location.pathname === '/manage' ? 'var(--text-primary)' : 'var(--text-secondary)',
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontWeight: location.pathname === '/manage' ? 600 : 400
              }}
            >
              <Settings size={18} /> Manage
            </Link>
          </nav>

          <button 
            onClick={handleSignOut}
            style={{ 
              background: 'transparent', border: '1px solid var(--panel-border)', 
              color: 'var(--text-secondary)', padding: '0.5rem 1rem', 
              borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/manage" element={<PortfolioManager />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <BrowserRouter>
      <AppContent session={session} handleSignOut={handleSignOut} />
    </BrowserRouter>
  );
}

export default App;
