import { useEffect, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './Dashboard.css';

export default function DashboardHome() {
  const [email, setEmail] = useState('');

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(data?.user?.email || '');
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="dash-container">
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <h2 className="dash-title">Dashboard</h2>
          <p className="dash-subtitle">
            Signed in{email ? ` as ${email}` : ''}. This is a placeholder dashboard.
          </p>

          <div className="dash-actions">
            <a className="dash-link" href="/">Back to Home</a>
            <button className="dash-logout" type="button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
