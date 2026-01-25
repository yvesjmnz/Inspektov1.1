import { useState, useEffect } from 'react';
import VerifyEmail from './modules/complaints_module/pages/VerifyEmail';
import RequestVerification from './modules/complaints_module/pages/RequestVerification';
import EmailVerificationModal from './modules/complaints_module/pages/EmailVerificationModal';
import ComplaintForm from './modules/complaints_module/pages/ComplaintForm';
import TrackComplaint from './modules/complaints_module/pages/TrackComplaint';
import Login from './modules/complaints_module/pages/Login';
import DashboardHome from './modules/dashboard_module/pages/DashboardHome';
import DashboardDirector from './modules/dashboard_module/pages/DashboardDirector';
import DashboardHeadInspector from './modules/dashboard_module/pages/DashboardHeadInspector';
import DashboardInspector from './modules/dashboard_module/pages/DashboardInspector';
import MissionOrderEditor from './modules/dashboard_module/pages/MissionOrderEditor';
import Header from './components/Header';
import Footer from './components/Footer';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

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
    } else if (path === '/track-complaint') {
      setCurrentPage('track-complaint');
    } else if (path === '/login') {
      setCurrentPage('login');
    } else if (path === '/dashboard') {
      setCurrentPage('dashboard');
    } else if (path === '/dashboard/director') {
      setCurrentPage('dashboard-director');
    } else if (path === '/dashboard/head-inspector') {
      setCurrentPage('dashboard-head-inspector');
    } else if (path === '/dashboard/inspector') {
      setCurrentPage('dashboard-inspector');
    } else if (path === '/mission-order') {
      setCurrentPage('mission-order');
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
      case 'track-complaint':
        return <TrackComplaint />;
      case 'login':
        return <Login />;
      case 'dashboard':
        return <DashboardHome />;
      case 'dashboard-director':
        return <DashboardDirector />;
      case 'dashboard-head-inspector':
        return <DashboardHeadInspector />;
      case 'dashboard-inspector':
        return <DashboardInspector />;
      case 'mission-order':
        return <MissionOrderEditor />;
      default:
        return <HomePage onOpenVerificationModal={() => setIsVerificationModalOpen(true)} />;
    }
  };

  return (
    <>
      {renderPage()}
      <EmailVerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)} 
      />
    </>
  );
}

function HomePage({ onOpenVerificationModal }) {
  const handleSubmitComplaint = (e) => {
    e.preventDefault();
    onOpenVerificationModal();
  };

  return (
    <div className="home-container">
      <Header />
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-left">
            <h2>Report Business Violations</h2>
            <p>Help us maintain business compliance and protect consumers through transparent reporting.</p>
            <div className="hero-buttons">
              <button 
                onClick={handleSubmitComplaint}
                className="btn btn-outline btn-red"
              >
                Submit a Complaint
              </button>
              <a href="/track-complaint" className="btn btn-outline btn-blue">
                Track Complaint Status
              </a>
            </div>
          </div>

          <div className="hero-right">
            <div className="right-column-left">
              <h3 className="process-title">How Inspekto Works</h3>
              <div className="steps-list">
                <div className="step-item">
                  <div className="step-circle">1</div>
                  <div className="step-content">
                    <h4 className="step-title">Report a concern</h4>
                    <p className="step-description">File a complaint with details and supporting evidence.</p>
                  </div>
                </div>
                <div className="step-item">
                  <div className="step-circle">2</div>
                  <div className="step-content">
                    <h4 className="step-title">We take action</h4>
                    <p className="step-description">Our team reviews the report and coordinates inspection.</p>
                  </div>
                </div>
                <div className="step-item">
                  <div className="step-circle">3</div>
                  <div className="step-content">
                    <h4 className="step-title">Stay informed</h4>
                    <p className="step-description">Track progress and receive updates.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="right-column-right">
              <div className="support-card">
                <h3 className="support-heading">Permit-related concerns?</h3>
                <div className="support-section">
                  <p className="support-intro">For business permit–related concerns (new applications, renewals, Go Manila access, account or inspection status):</p>
                  <div className="support-content">
                    <p><strong>Facebook:</strong> Bureau of Permits Manila</p>
                    <p><strong>Email:</strong> permits@manila.gov.ph</p>
                    <p><strong>Phone:</strong> (02) 8527-0871</p>
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

export default App;
