import { useState, useEffect } from 'react';
import VerifyEmail from './modules/complaints_module/pages/VerifyEmail';
import RequestVerification from './modules/complaints_module/pages/RequestVerification';
import EmailVerificationModal from './modules/complaints_module/pages/EmailVerificationModal';
import ComplaintForm from './modules/complaints_module/pages/ComplaintForm';
import ComplaintConfirmation from './modules/complaints_module/pages/ComplaintConfirmation';
import TrackComplaint from './modules/tracking_module/pages/TrackComplaint';
import Login from './modules/dashboard_module/pages/Login';
import NoPermission from './modules/complaints_module/pages/NoPermission';
import DashboardHome from './modules/dashboard_module/pages/DashboardHome';
import DashboardDirector from './modules/dashboard_module/pages/DashboardDirector';
import DashboardHeadInspector from './modules/dashboard_module/pages/DashboardHeadInspector';
import DashboardInspector from './modules/dashboard_module/pages/DashboardInspector';
import InspectorInspectionDetails from './modules/dashboard_module/pages/InspectorInspectionDetails';
import MissionOrderEditor from './modules/mission_order_module/pages/MissionOrderEditor';
import MissionOrderReview from './modules/mission_order_module/pages/MissionOrderReview';
import LandingPage from './LandingPage';
import ComplaintView from './modules/complaints_module/pages/ComplaintView';
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
    if (path === '/dashboard/inspector/inspection') return normalizedRole === 'inspector' || normalizedRole === 'head_inspector';

    // Mission order pages
    if (path === '/mission-order') return normalizedRole === 'head_inspector';
    if (path === '/mission-order/review') return normalizedRole === 'director';

    // Complaint view (director only)
    if (path === '/complaints/view') return normalizedRole === 'director';

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
        path === '/dashboard/inspector/inspection' ||
        path === '/mission-order' ||
        path === '/mission-order/review' ||
        path === '/complaints/view';

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
        // Check for email parameter (from token verification)
        const emailParam = params.get('email');

        if (!mounted) return;

        if (!emailParam) {
          // No email parameter, redirect to request verification
          window.location.href = '/request-verification';
          return;
        }

        setVerifiedEmail(decodeURIComponent(emailParam));
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
      } else if (path === '/dashboard/inspector/inspection') {
        setCurrentPage('inspector-inspection-details');
      } else if (path === '/mission-order') {
        setCurrentPage('mission-order');
      } else if (path === '/mission-order/review') {
        setCurrentPage('mission-order-review');
      } else if (path === '/complaints/view') {
        setCurrentPage('complaint-view');
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
      case 'inspector-inspection-details':
        return <InspectorInspectionDetails />;
      case 'mission-order':
        return <MissionOrderEditor />;
      case 'mission-order-review':
        return <MissionOrderReview />;
      case 'complaint-view':
        return <ComplaintView />;
      case 'no-permission':
        return <NoPermission />;
      default:
        return <LandingPage onOpenVerificationModal={() => setIsVerificationModalOpen(true)} />;
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


export default App;
