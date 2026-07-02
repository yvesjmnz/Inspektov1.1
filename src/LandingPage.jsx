import Header from './components/Header';
import Footer from './components/Footer';
import './LandingPage.css';

function LandingPage({ onOpenVerificationModal }) {
  const collageImages = [
    { src: '/landing 2.jpg' },
    { src: '/landing 3.jpg' },
    { src: '/landing5.jpg' }
  ];
  const collageTrack = [...collageImages, ...collageImages];

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
              <div className="hero-collage-shell" aria-hidden="true">
                <div className="hero-collage-stage">
                  <div className="hero-collage-track">
                    {collageTrack.map((image, index) => (
                      <figure
                        key={`track-${index}`}
                        className={`hero-collage-card tilt-${(index % 4) + 1}`}
                      >
                        <img src={image.src} alt="" loading="lazy" decoding="async" />
                      </figure>
                    ))}
                  </div>
                </div>
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
              <div className="contact-feature">
                <div className="contact-media">
                  <div className="contact-visual-pair">
                    <figure className="contact-visual contact-visual-main">
                      <img src="/manila.png" alt="Manila city view" loading="lazy" decoding="async" />
                    </figure>
                    <figure className="contact-visual contact-visual-secondary">
                      <img src="/cropped-bureau.png" alt="Bureau of Permits office" loading="lazy" decoding="async" />
                    </figure>
                  </div>
                </div>

                <div className="contact-content">
                  <h2 className="contact-feature-title">Permit and Complaint Assistance</h2>
                  <div className="contact-feature-rule" aria-hidden="true"></div>
                  <p className="contact-feature-copy">
                    For business permit applications, renewals, Go Manila access, account status, inspection scheduling,
                    and other special complaints that require direct assistance, please contact the Bureau of Permits.
                  </p>

                  <a className="text-link" href="https://www.facebook.com/bureauofpermitsmnl/" target="_blank" rel="noopener noreferrer">Visit Bureau of Permits →</a>

                  <div className="contact-detail-list">
                    <div className="contact-detail-item contact-detail-item-email">
                      <div className="contact-detail-label">Email</div>
                      <div className="contact-detail-value">permits@manila.gov.ph</div>
                    </div>
                    <div className="contact-detail-item contact-detail-item-phone">
                      <div className="contact-detail-label">Phone</div>
                      <div className="contact-detail-value">(02) 8527-0871</div>
                    </div>
                    <div className="contact-detail-item contact-detail-item-hours">
                      <div className="contact-detail-label">Office Hours</div>
                      <div className="contact-detail-value">
                        <span>Monday - Friday</span>
                        <span>8:00 AM - 5:00 PM</span>
                      </div>
                      <div className="contact-detail-note">Except holidays</div>
                    </div>
                  </div>
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
