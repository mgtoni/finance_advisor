import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import { supabase } from './lib/supabase';
import { LogOut } from 'lucide-react';

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
    <div className="app-container">
      <header className="header">
        <div>
          <h1>Quant Advisor</h1>
          <p>Automated AI Portfolio Management</p>
        </div>
        {session && (
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
        )}
      </header>
      <main>
        {!session ? (
          <Auth onAuthSuccess={setSession} />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

export default App;
