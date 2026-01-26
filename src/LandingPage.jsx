import Header from './components/Header';
import Footer from './components/Footer';
import './LandingPage.css';

function LandingPage({ onOpenVerificationModal }) {
  const handleSubmitComplaint = (e) => {
    e.preventDefault();
    // Open email verification modal
    onOpenVerificationModal();
  };

  return (
    <div className="home-container">
      <Header />
      <main className="home-standalone">
        <section className="hero-wrap">
          <div className="hero-grid">
            <div className="hero-col">
              <h1 className="hero-title">Report <span className="accent">Business</span> Violations</h1>
              <p className="hero-sub">Protect your community. Report non-compliant businesses and help maintain fair trade practices in Manila.</p>
              <div className="hero-actions">
                <button onClick={handleSubmitComplaint} className="pill-btn pill-primary">File a Report</button>
                <a href="/track-complaint" className="pill-btn pill-outline">Track Your Case</a>
              </div>
            </div>
            <div className="hero-col">
              <div className="mock-card">
                <div className="mock-top">
                  <span className="b b1"></span><span className="b b2"></span><span className="b b3"></span>
                </div>
                <div className="mock-lines"></div>
                <div className="mock-upload">Upload Evidence</div>
                <div className="mock-lines small"></div>
                <div className="mock-cta">Ready to submit? <span className="mock-go">→</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="band-dark">
          <div className="band-wrap">
            <div className="band-header">
              <div className="label">Simple Process</div>
              <h2>How It Works</h2>
            </div>
            <div className="step-cards">
              <div className="step-card">
                <div className="step-num">01</div>
                <h3>Submit Your Report</h3>
                <p>Fill out the complaint form with business details, violation type, and supporting evidence.</p>
              </div>
              <div className="step-card">
                <div className="step-num">02</div>
                <h3>Investigation Begins</h3>
                <p>Our inspection team reviews your case and schedules on-site verification if needed.</p>
              </div>
              <div className="step-card">
                <div className="step-num">03</div>
                <h3>Get Notified</h3>
                <p>Receive real-time updates via email as your case progresses.</p>
              </div>
              <div className="step-card">
                <div className="step-num">04</div>
                <h3>Case Resolution</h3>
                <p>View the final outcome and any enforcement actions taken against violations.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="band-light">
          <div className="band-wrap grid-2">
            <div className="permit-left">
                            <h2>Have permit-related concerns?</h2>
              <p>For business permit applications, renewals, Go Manila access, account status, or inspection scheduling — contact the Bureau of Permits directly.</p>
              <a className="text-link" href="https://www.facebook.com/bureauofpermitsmnl/" target="_blank" rel="noopener noreferrer">Visit Bureau of Permits →</a>
            </div>
            <div className="permit-right">
              <div className="mini-cards">
                <div className="mini-card">
                  <div className="mini-title">Email us at</div>
                  <div className="mini-val">permits@manila.gov.ph</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">Call us at</div>
                  <div className="mini-val">(02) 8527-0871</div>
                </div>
              </div>
              <div className="hours-card">
                <div className="mini-title">Office Hours</div>
                <div className="mini-val strong">Monday – Friday, 8:00 AM – 5:00 PM</div>
                <div className="mini-sub">Except holidays</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default LandingPage;
