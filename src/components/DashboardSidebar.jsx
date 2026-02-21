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
          label: 'Dashboard',
          icon: '/ui_icons/menu.png',
          href: '/dashboard/director',
          section: null,
        },
        {
          label: 'Complaints',
          section: 'COMPLAINTS',
        },
        {
          label: 'Review Complaints',
          icon: '/ui_icons/queue.png',
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
          label: 'To Do',
          icon: '/ui_icons/task.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'todo',
        },
        {
          label: 'Issued',
          icon: '/ui_icons/queue.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'issued',
        },
        {
          label: 'For Inspection',
          icon: '/ui_icons/inspection.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'for-inspection',
        },
        {
          label: 'Revisions',
          icon: '/ui_icons/revision.png',
          href: '/dashboard/head-inspector',
          section: null,
          tabName: 'revisions',
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
        {navItems.map((item, idx) => {
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
          return (
            <li key={`nav-${idx}`}>
              <button
                type="button"
                className="dash-nav-item"
                onClick={() => window.location.assign(item.href)}
              >
                <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={item.icon}
                    alt=""
                    style={{
                      width: 22,
                      height: 22,
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
