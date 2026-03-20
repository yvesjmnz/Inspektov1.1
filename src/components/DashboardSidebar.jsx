import { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * DashboardSidebar Component
 * 
 * Reusable sidebar for all dashboard pages (Director, Head Inspector, Inspector)
 * Handles role-based navigation and styling
 * 
 * Props:
 * - role: 'director' | 'head_inspector' | 'inspector'
 * - onLogout: callback function for logout
 * - collapsed: boolean state for sidebar collapse
 * - onCollapsedChange: callback to update collapsed state
 */
export default function DashboardSidebar({ role, onLogout, collapsed = false, onCollapsedChange }) {
  const [navCollapsed, setNavCollapsed] = useState(collapsed);

  const handleCollapse = (e) => {
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
    const newState = !navCollapsed;
    setNavCollapsed(newState);
    if (onCollapsedChange) onCollapsedChange(newState);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
      e.preventDefault();
      const newState = !navCollapsed;
      setNavCollapsed(newState);
      if (onCollapsedChange) onCollapsedChange(newState);
    }
  };

  const normalizedRole = String(role || '').toLowerCase();

  // Navigation items based on role
  const getNavItems = () => {
    if (normalizedRole === 'director') {
      return [
        {
          label: 'Complaints',
          section: 'COMPLAINTS',
        },
        {
          label: 'Review Complaints',
          icon: '/ui_icons/queue.png',
          iconSize: 26,
          href: '/dashboard/director?tab=queue',
          section: null,
        },
        {
          label: 'Complaint History',
          icon: '/ui_icons/history.png',
          href: '/dashboard/director?tab=history',
          section: null,
        },
        {
          label: 'Mission Orders',
          section: 'MISSION ORDERS',
        },
        {
          label: 'Review Mission Orders',
          icon: '/ui_icons/mo.png',
          href: '/dashboard/director?tab=mission-orders',
          section: null,
        },
        {
          label: 'Mission Order History',
          icon: '/ui_icons/history.png',
          href: '/dashboard/director?tab=mission-orders-history',
          section: null,
        },
        {
          label: 'Inspections',
          section: 'INSPECTION',
        },
        {
          label: 'Inspections',
          icon: '/ui_icons/inspection.png',
          href: '/dashboard/director?tab=inspection',
          section: null,
        },
        {
          label: 'Inspection History',
          icon: '/ui_icons/history.png',
          href: '/dashboard/director?tab=inspection-history',
          section: null,
        },
        {
          label: 'Reports',
          section: 'REPORTS',
        },
        {
          label: 'Performance Report',
          icon: '/ui_icons/document.png',
          href: '/dashboard/director?tab=reports',
          section: null,
        },
      ];
    }

    if (normalizedRole === 'head_inspector') {
      return [
        {
          label: 'Dashboard',
          icon: '/ui_icons/menu.png',
          href: '/dashboard/head-inspector',
          section: null,
        },
        {
          label: 'Mission Orders',
          section: 'MISSION ORDERS',
        },
        {
          label: 'Draft',
          icon: '/ui_icons/menu.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'todo',
        },
        {
          label: 'Director Approval',
          icon: '/ui_icons/mo.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'results',
        },
        {
          label: 'Secretary Approval',
          icon: '/ui_icons/queue.png',
          iconSize: 24,
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'for-inspection',
        },
        {
          label: 'Mission Order History',
          icon: '/ui_icons/history.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'revisions',
        },
        {
          label: 'Inspection',
          section: 'INSPECTION',
        },
        {
          label: 'Inspection',
          icon: '/ui_icons/inspection.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'inspection',
        },
        {
          label: 'Inspection History',
          icon: '/ui_icons/history.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'inspection-history',
        },
        {
          label: 'Analytics',
          section: 'ANALYTICS',
        },
        {
          label: 'Performance Report',
          icon: '/ui_icons/document.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'reports',
        },
      ];
    }

    if (normalizedRole === 'inspector') {
      return [
        {
          label: 'Dashboard',
          icon: '/ui_icons/menu.png',
          href: '/dashboard/inspector',
          section: null,
        },
        {
          label: 'Inspections',
          section: 'INSPECTIONS',
        },
        {
          label: 'Assigned Inspections',
          icon: '/ui_icons/inspection.png',
          href: '/dashboard/inspector',
          section: null,
        },
      ];
    }

    return [];
  };

  const navItems = getNavItems();

  // Determine active nav item based on current URL
  const getActiveNavItem = () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const hash = window.location.hash.slice(1);

    // For complaint review page, check if we came from queue or history
    if (path === '/complaint/review') {
      const referrerTab = sessionStorage.getItem('complaintReviewSource');
      if (referrerTab === 'history') {
        return 'Complaint History';
      }
      return 'Review Complaints'; // default to queue
    }

    // For mission order page, check the hash to determine which tab.
    // NOTE: This page is shared across roles, but the sidebar labels differ.
    // - Head Inspector uses: Draft/Director Approval/Secretary Approval/Mission Order History/Inspection...
    // - Director uses: Review Mission Orders/Mission Order History/Inspections...
    if (path === '/mission-order') {
      // Director should NOT see Head Inspector tab labels (Draft/Director Approval/etc.) in the sidebar.
      // Keep the Director sidebar consistent with /dashboard/director.
      if (normalizedRole === 'director') {
        // If the full view is opened from the Director review flow, highlight Review Mission Orders.
        // Otherwise default to Mission Order History (most common entry point).
        const moSource = sessionStorage.getItem('missionOrderSource');
        if (moSource === 'review') return 'Review Mission Orders';

        if (hash === 'inspection') return 'Inspections';
        if (hash === 'inspection-history') return 'Inspection History';
        return 'Mission Order History';
      }

      // Head Inspector / Inspector behavior (existing tab mapping)
      if (hash === 'todo') return 'Draft';
      if (hash === 'results') return 'Director Approval';
      if (hash === 'for-inspection') return 'Secretary Approval';
      if (hash === 'revisions') return 'Mission Order History';
      if (hash === 'inspection') return 'Inspection';
      if (hash === 'inspection-history') return 'Inspection History';
      if (hash === 'reports') return 'Performance Report';
      return 'Draft'; // default to Draft
    }

    // For mission order review page
    if (path === '/mission-order/review') {
      return 'Review Mission Orders';
    }

    // For dashboard pages with tabs
    if (path === '/dashboard/director') {
      if (tab === 'queue') return 'Review Complaints';
      if (tab === 'history') return 'Complaint History';
      if (tab === 'mission-orders') return 'Review Mission Orders';
      if (tab === 'mission-orders-history') return 'Mission Order History';
      if (tab === 'inspection') return 'Inspections';
      if (tab === 'inspection-history') return 'Inspection History';
      if (tab === 'reports') return 'Performance Report';
      // Director dashboard overview tab was removed; default highlight to queue.
      return 'Review Complaints';
    }

    if (path === '/dashboard/head-inspector') {
      // Check hash first (from mission-order back button), then query param
      if (hash) {
        if (hash === 'todo') return 'Draft';
        if (hash === 'results') return 'Director Approval';
        if (hash === 'for-inspection') return 'Secretary Approval';
        if (hash === 'revisions') return 'Mission Order History';
        if (hash === 'reports') return 'Performance Report';
        if (hash === 'inspection') return 'Inspection';
        if (hash === 'inspection-history') return 'Inspection History';
      }
      if (tab === 'todo') return 'Draft';
      if (tab === 'results') return 'Director Approval';
      if (tab === 'for-inspection') return 'Secretary Approval';
      if (tab === 'revisions') return 'Mission Order History';
      if (tab === 'reports') return 'Performance Report';
      if (tab === 'inspection') return 'Inspection';
      if (tab === 'inspection-history') return 'Inspection History';
      return 'Dashboard';
    }

    if (path === '/dashboard/inspector') {
      return 'Dashboard';
    }

    return null;
  };

  const activeItem = getActiveNavItem();

  // Filter nav items based on current page
  const filteredNavItems = navItems.filter((item) => {
    const path = window.location.pathname;

    // Hide Dashboard item for Director role (overview tab removed)
    if (normalizedRole === 'director' && item.label === 'Dashboard') {
      return false;
    }

    // Hide Dashboard item when on mission order page
    if (path === '/mission-order' && item.label === 'Dashboard') {
      return false;
    }

    return true;
  });

  return (
    <aside
      className="dash-side"
      title="Menu"
      style={{ width: navCollapsed ? 72 : 240, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
      onClick={handleCollapse}
      onKeyDown={handleKeyDown}
    >
      {/* Brand Section */}
      <div className="dash-side-brand" title="Menu">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <img src="/logo.png" alt="City Hall Logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: '50%' }} />
        </div>
        <div className="hamburger" aria-hidden="true">
          <div className="hamburger-bar"></div>
          <div className="hamburger-bar"></div>
          <div className="hamburger-bar"></div>
        </div>
      </div>

      {/* Navigation Items */}
      <ul className="dash-nav" style={{ flex: 1 }}>
        {filteredNavItems.map((item, idx) => {
          // Section header
          if (item.section) {
            return (
              <li key={`section-${idx}`} className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
                  {item.section}
                </span>
              </li>
            );
          }

          // Navigation item
          const isActive = item.label === activeItem;
          const href = item.tabName ? `${item.href}#${item.tabName}` : item.href;
          const iconSize = item.iconSize || 22;
          return (
            <li key={`nav-${idx}`}>
              <button
                type="button"
                className={`dash-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  // Track source so the Mission Order full view can keep the correct Director highlight.
                  // (Avoids showing Head Inspector tab labels when Director opens /mission-order.)
                  if (normalizedRole === 'director') {
                    const params = new URLSearchParams(new URL(href, window.location.origin).search);
                    const nextTab = params.get('tab');
                    if (nextTab === 'mission-orders') sessionStorage.setItem('missionOrderSource', 'review');
                    else if (nextTab === 'mission-orders-history') sessionStorage.setItem('missionOrderSource', 'history');
                  }
                  window.location.assign(href);
                }}
              >
                <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={item.icon}
                    alt=""
                    style={{
                      width: iconSize,
                      height: iconSize,
                      objectFit: 'contain',
                      display: 'block',
                      filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)',
                    }}
                  />
                </span>
                <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Logout Button */}
      <button
        type="button"
        className="dash-nav-item"
        onClick={onLogout}
        style={{
          marginTop: 'auto',
          border: 'none',
          background: 'transparent',
          color: '#ef4444',
          fontWeight: 800,
          textAlign: 'left',
          padding: '10px 12px',
          borderRadius: 10,
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '24px 1fr',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src="/ui_icons/logout.png"
            alt=""
            style={{
              width: 22,
              height: 22,
              objectFit: 'contain',
              display: 'block',
              filter: 'brightness(0) saturate(100%) invert(21%) sepia(97%) saturate(4396%) hue-rotate(346deg) brightness(95%) contrast(101%)',
            }}
          />
        </span>
        <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
          Logout
        </span>
      </button>
    </aside>
  );
}
