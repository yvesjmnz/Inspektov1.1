import { useState, useEffect } from 'react';
import VerifyEmail from './components/VerifyEmail';
import RequestVerification from './components/RequestVerification';
import ComplaintForm from './components/ComplaintForm';
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
      <header className="header">
        <div className="header-content">
          <h1 className="logo">Inspekto</h1>
          <p className="tagline">Complaint Management System</p>
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <h2>Report Business Violations</h2>
          <p>Help us maintain business compliance and protect consumers through transparent reporting.</p>
          <a href="/request-verification" className="btn btn-primary btn-large">
            Submit a Complaint
          </a>
        </section>

        <section className="features">
          <div className="feature-card">
            <div className="feature-icon">1</div>
            <h3>Request Verification</h3>
            <p>Enter your email to receive a verification link</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">2</div>
            <h3>Verify Email</h3>
            <p>Click the link in your email to verify your identity</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">3</div>
            <h3>Submit Complaint</h3>
            <p>Fill out the complaint form with details and evidence</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>Inspekto - Complaint Management System</p>
      </footer>
    </div>
  );
}

export default App;
