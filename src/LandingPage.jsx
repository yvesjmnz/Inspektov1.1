import { useState } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import './LandingPage.css';

function LandingPage({ onOpenVerificationModal }) {
  const [contactCategory, setContactCategory] = useState('permit');

  const handleSubmitComplaint = (e) => {
    e.preventDefault();
    // Open email verification modal
    onOpenVerificationModal();
  };

  const categoryContent = {
    permit: {
      title: "Have permit-related concerns?",
      description: "For business permit applications, renewals, Go Manila access, account status, or inspection scheduling — contact the Bureau of Permits directly.",
      showLink: true
    },
    special: {
      title: "Special Complaints & Requests",
      description: "For government-issued complaints, official agency-related concerns, and other special requests that require manual handling, please contact the Bureau of Permits directly.",
      showLink: false
    }
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
          <div className="band-wrap">
            <div className="contact-section">
              <div className="contact-header">
                <h2>Contact the Bureau of Permits</h2>
                <div className="category-selector">
                  <button
                    className={`category-btn ${contactCategory === 'permit' ? 'active' : ''}`}
                    onClick={() => setContactCategory('permit')}
                  >
                    Permit Concerns
                  </button>
                  <button
                    className={`category-btn ${contactCategory === 'special' ? 'active' : ''}`}
                    onClick={() => setContactCategory('special')}
                  >
                    Special Complaints & Requests
                  </button>
                </div>
              </div>

              <div className="contact-description">
                <h3>{categoryContent[contactCategory].title}</h3>
                <p>{categoryContent[contactCategory].description}</p>
                {categoryContent[contactCategory].showLink && (
                  <a className="text-link" href="https://www.facebook.com/bureauofpermitsmnl/" target="_blank" rel="noopener noreferrer">Visit Bureau of Permits →</a>
                )}
              </div>

              <div className="contact-info-row">
                <div className="contact-info-card">
                  <div className="contact-info-label">Email us at</div>
                  <div className="contact-info-value">permits@manila.gov.ph</div>
                </div>
                <div className="contact-info-card">
                  <div className="contact-info-label">Call us at</div>
                  <div className="contact-info-value">(02) 8527-0871</div>
                </div>
                <div className="contact-info-card">
                  <div className="contact-info-label">Office Hours</div>
                  <div className="contact-info-value">Monday – Friday, 8:00 AM – 5:00 PM</div>
                  <div className="contact-info-sub">Except holidays</div>
                </div>
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
