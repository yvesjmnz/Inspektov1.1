import Header from '../../../components/Header';
import Footer from '../../../components/Footer';

export default function NoPermission() {
  return (
    <div className="home-container">
      <Header />
      <main className="home-standalone" style={{ padding: '40px 20px' }}>
        <section className="band-light" style={{ borderRadius: 16 }}>
          <div className="band-wrap" style={{ padding: 24 }}>
            <div className="label">Access denied</div>
            <h2 style={{ marginTop: 10 }}>You do not have permission</h2>
            <p style={{ marginTop: 8, maxWidth: 720 }}>
              The page you tried to access is restricted. If you believe you should have access,
              please sign in with an authorized account or contact an administrator.
            </p>
            <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className="pill-btn pill-primary" href="/login">Go to Login</a>
              <a className="pill-btn pill-outline" href="/">Back to Home</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
