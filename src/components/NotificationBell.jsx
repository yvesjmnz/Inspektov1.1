import { useState, useEffect } from 'react';
import { useNotifications } from '../lib/notifications/useNotifications';

/**
 * NotificationBell Component
 * 
 * Reusable notification bell with dropdown panel.
 * Single responsibility: Display and manage notifications UI.
 */
export default function NotificationBell({ userId }) {
  const [showPanel, setShowPanel] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    archive,
  } = useNotifications(userId);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (e.target.closest('.notification-bell-container')) return;
      setShowPanel(false);
    };

    if (showPanel) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showPanel]);

  if (!userId) return null;

  return (
    <div className="notification-bell-container" style={{ position: 'relative' }}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setShowPanel(!showPanel)}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#0f172a',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#2563eb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#0f172a';
        }}
        aria-label="Notifications"
        title={`${unreadCount} unread notifications`}
      >
        {/* Bell SVG Icon */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#ef4444',
              color: '#fff',
              borderRadius: '50%',
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 'bold',
              border: '2px solid #fff',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {showPanel && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: 'min(400px, 90vw)',
            maxHeight: '500px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            marginTop: 8,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {loading ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                No notifications
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #f1f5f9',
                    background: notification.status === 'unread' ? '#f0f9ff' : '#fff',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      notification.status === 'unread' ? '#e0f2fe' : '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      notification.status === 'unread' ? '#f0f9ff' : '#fff';
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: '#0f172a',
                          fontSize: 14,
                        }}
                      >
                        {notification.title}
                      </div>
                      <div
                        style={{
                          color: '#64748b',
                          fontSize: 13,
                          marginTop: 4,
                          lineHeight: 1.4,
                        }}
                      >
                        {notification.message}
                      </div>
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: 12,
                          marginTop: 6,
                        }}
                      >
                        {new Date(notification.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      {notification.status === 'unread' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#1d4ed8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#2563eb';
                          }}
                          title="Mark as read"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          archive(notification.id);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = '#dc2626';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = '#ef4444';
                        }}
                        title="Archive"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
