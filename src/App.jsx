import { useState, useEffect } from 'react';
import VerifyEmail from './modules/complaints_module/pages/VerifyEmail';
import RequestVerification from './modules/complaints_module/pages/RequestVerification';
import ComplaintForm from './modules/complaints_module/pages/ComplaintForm';
import Header from './components/Header';
import Footer from './components/Footer';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [verifiedEmail, setVerifiedEmail] = useState(null);

  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');

    if (email) {
      setVerifiedEmail(decodeURIComponent(email));
    }

    if (path === '/verify-email') {
      setCurrentPage('verify-email');
    } else if (path === '/request-verification') {
      setCurrentPage('request-verification');
    } else if (path === '/complaint') {
      setCurrentPage('complaint');
    } else {
      setCurrentPage('home');
    }
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'verify-email':
        return <VerifyEmail />;
      case 'request-verification':
        return <RequestVerification />;
      case 'complaint':
        return <ComplaintForm verifiedEmail={verifiedEmail} />;
      default:
        return <HomePage />;
    }
  };

  return renderPage();
}

function HomePage() {
  return (
    <div className="home-container">
      <Header />
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-left">
            <h2>Report Business Violations</h2>
            <p>Help us maintain business compliance and protect consumers through transparent reporting.</p>
            <div className="hero-buttons">
              <a href="/request-verification" className="btn btn-outline btn-red">
                Submit a Complaint
              </a>
              <a href="#" className="btn btn-outline btn-blue">
                Track Complaint Status
              </a>
            </div>
          </div>

          <div className="hero-right">
            <div className="steps-list">
              <div className="step-item">
                <div className="step-circle">1</div>
                <div className="step-text">Submit your complaint details</div>
              </div>
              <div className="step-item">
                <div className="step-circle">2</div>
                <div className="step-text">We review and investigate</div>
              </div>
              <div className="step-item">
                <div className="step-circle">3</div>
                <div className="step-text">Get resolution and updates</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default App;
