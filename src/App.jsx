import { useState, useEffect } from 'react';
import VerifyEmail from './modules/complaints_module/pages/VerifyEmail';
import RequestVerification from './modules/complaints_module/pages/RequestVerification';
import EmailVerificationModal from './modules/complaints_module/pages/EmailVerificationModal';
import ComplaintForm from './modules/complaints_module/pages/ComplaintForm';
import ComplaintConfirmation from './modules/complaints_module/pages/ComplaintConfirmation';
import TrackComplaint from './modules/complaints_module/pages/TrackComplaint';
import Login from './modules/complaints_module/pages/Login';
import NoPermission from './modules/complaints_module/pages/NoPermission';
import DashboardHome from './modules/dashboard_module/pages/DashboardHome';
import DashboardDirector from './modules/dashboard_module/pages/DashboardDirector';
import DashboardHeadInspector from './modules/dashboard_module/pages/DashboardHeadInspector';
import DashboardInspector from './modules/dashboard_module/pages/DashboardInspector';
import MissionOrderEditor from './modules/dashboard_module/pages/MissionOrderEditor';
import Header from './components/Header';
import Footer from './components/Footer';
import { supabase } from './lib/supabase';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState(null);
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

  const getRoleFromUser = (user) => {
    if (!user) return null;
    const role = user?.app_metadata?.role || user?.user_metadata?.role;
    return role ? String(role).toLowerCase() : null;
  };

  const normalizeRole = (roleValue) => {
    const role = String(roleValue || '').toLowerCase();
    if (role === 'head inspector' || role === 'head_inspector' || role === 'headinspector') {
      return 'head_inspector';
    }
    if (role === 'director') return 'director';
    if (role === 'inspector') return 'inspector';
    return role || null;
  };

  const getRoleFromProfiles = async (userId) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data?.role ? normalizeRole(data.role) : null;
    } catch (_e) {
      return null;
    }
  };

  const isAuthorizedForPath = (path, normalizedRole) => {
    // If the route is a dashboard route, require auth and enforce role.
    if (path === '/dashboard') return Boolean(normalizedRole);
    if (path === '/dashboard/director') return normalizedRole === 'director';
    if (path === '/dashboard/head-inspector') return normalizedRole === 'head_inspector';
    if (path === '/dashboard/inspector') return normalizedRole === 'inspector' || normalizedRole === 'head_inspector';

    // Mission order editor is at least head inspector (adjust if needed)
    if (path === '/mission-order') return normalizedRole === 'head_inspector';

    // Public routes
    return true;
  };

  useEffect(() => {
    let mounted = true;

    // Ensure we never render the default page while deciding where to go.
    setCurrentPage(null);

    (async () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      const email = params.get('email');

      if (email) {
        setVerifiedEmail(decodeURIComponent(email));
      }

      // Determine if this is a protected route
      const isProtected =
        path === '/dashboard' ||
        path === '/dashboard/director' ||
        path === '/dashboard/head-inspector' ||
        path === '/dashboard/inspector' ||
        path === '/mission-order';

      let normalizedRole = null;
      if (isProtected) {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user || null;

        normalizedRole = normalizeRole(getRoleFromUser(user));
        if (!normalizedRole && user?.id) {
          normalizedRole = await getRoleFromProfiles(user.id);
        }

        if (!mounted) return;

        if (!isAuthorizedForPath(path, normalizedRole)) {
          setCurrentPage('no-permission');
          return;
        }
      }

      if (!mounted) return;

      if (path === '/verify-email') {
        setCurrentPage('verify-email');
      } else if (path === '/request-verification') {
        setCurrentPage('request-verification');
      } else if (path === '/complaint') {
        setCurrentPage('complaint');
      } else if (path === '/complaint-confirmation') {
        setCurrentPage('complaint-confirmation');
      } else if (path === '/track-complaint') {
        setCurrentPage('track-complaint');
      } else if (path === '/login') {
        setCurrentPage('login');
      } else if (path === '/no-permission') {
        setCurrentPage('no-permission');
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
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const renderPage = () => {
    // Prevent initial "home" flash while auth/role checks are running.
    if (currentPage === null) return null;

    switch (currentPage) {
      case 'verify-email':
        return <VerifyEmail />;
      case 'request-verification':
        return <RequestVerification />;
      case 'complaint':
        return <ComplaintForm verifiedEmail={verifiedEmail} />;
      case 'complaint-confirmation':
        return <ComplaintConfirmation />;
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
      case 'no-permission':
        return <NoPermission />;
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

export default App;
