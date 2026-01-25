import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './Dashboard.css';

export default function DashboardInspector() {
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="dash-container">
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <h2 className="dash-title">Inspector Dashboard</h2>
          <p className="dash-subtitle">Your assigned inspections and field tools (features will be added step-by-step).</p>

          <div className="dash-grid">
            <div className="dash-tile">
              <h3>Assigned Work</h3>
              <ul>
                <li>View assigned inspections</li>
                <li>Access inspection details</li>
                <li>Track inspection status</li>
              </ul>
            </div>

            <div className="dash-tile">
              <h3>Field Tools</h3>
              <ul>
                <li>Live map previews</li>
                <li>Receive notifications</li>
              </ul>
            </div>

            <div className="dash-tile">
              <h3>History & Performance</h3>
              <ul>
                <li>Track inspection history</li>
                <li>View performance</li>
              </ul>
            </div>
          </div>

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
