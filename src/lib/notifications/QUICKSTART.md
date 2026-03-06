# Notifications Service - Quick Start Guide

## 5-Minute Setup

### 1. Database Setup
```bash
# Run the migration
supabase migration up

# Or manually execute the SQL in:
# supabase/migrations/20260305000000_add_notifications_table.sql
```

### 2. Add to DashboardDirector.jsx

```javascript
import { useNotifications } from '../../../lib/notifications/useNotifications';
import { notifyHeadInspectorComplaintApproved } from '../../../lib/notifications/notificationTriggers';

export default function DashboardDirector() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);

  const { notifications, unreadCount, markAsRead, markAllAsRead, archive } = 
    useNotifications(currentUserId);

  // Get current user
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData?.user?.id);
    };
    getCurrentUser();
  }, []);

  // When approving complaint, notify Head Inspector
  const updateComplaintStatus = async (complaintId, newStatus) => {
    // ... existing approval logic ...
    
    if (newStatus === 'approved') {
      const { data: complaint } = await supabase
        .from('complaints')
        .select('business_name')
        .eq('id', complaintId)
        .single();

      await notifyHeadInspectorComplaintApproved(
        complaintId,
        complaint?.business_name
      );
    }
  };

  // Add notification bell to header
  return (
    <div className="dash-header">
      <div>
        <h2>{pageMeta.title}</h2>
        <p>{pageMeta.subtitle}</p>
      </div>
      <div className="dash-actions">
        <button
          onClick={() => setShowNotificationPanel(!showNotificationPanel)}
          style={{ position: 'relative', fontSize: 24, background: 'none', border: 'none' }}
        >
          🔔
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: 0, right: 0,
              background: '#ef4444', color: '#fff',
              borderRadius: '50%', width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 'bold'
            }}>
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
```

### 3. Add to DashboardHeadInspector.jsx

```javascript
import { useNotifications } from '../../../lib/notifications/useNotifications';

export default function DashboardHeadInspector() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const { notifications, unreadCount } = useNotifications(currentUserId);

  // Auto-refresh when complaint approved
  useEffect(() => {
    const complaintApprovedNotifications = notifications.filter(
      (n) => n.type === 'complaint_approved'
    );
    if (complaintApprovedNotifications.length > 0) {
      loadApprovedComplaints();
    }
  }, [notifications]);

  // ... rest of component
}
```

### 4. Add to DashboardInspector.jsx

```javascript
import { useNotifications } from '../../../lib/notifications/useNotifications';

export default function DashboardInspector() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const { notifications, unreadCount } = useNotifications(currentUserId);

  // Auto-refresh when mission order assigned
  useEffect(() => {
    const moNotifications = notifications.filter(
      (n) => n.type === 'mission_order_for_inspection'
    );
    if (moNotifications.length > 0) {
      loadAssigned();
    }
  }, [notifications]);

  // ... rest of component
}
```

## Triggering Notifications

### When Director Approves Complaint
```javascript
import { notifyHeadInspectorComplaintApproved } from '../lib/notifications/notificationTriggers';

// In your complaint approval handler
await notifyHeadInspectorComplaintApproved(
  complaintId,
  businessName
);
```

### When Mission Order is Submitted
```javascript
import { notifyDirectorMissionOrderSubmitted } from '../lib/notifications/notificationTriggers';

// When MO is created/submitted
await notifyDirectorMissionOrderSubmitted(
  missionOrderId,
  complaintId,
  businessName
);
```

### When Inspector is Assigned
```javascript
import { notifyInspectorMissionOrderAssigned } from '../lib/notifications/notificationTriggers';

// When assigning inspector to MO
await notifyInspectorMissionOrderAssigned(
  missionOrderId,
  inspectorId,
  businessName
);
```

## Key Files

| File | Purpose |
|------|---------|
| `notificationService.js` | Core CRUD operations |
| `notificationTriggers.js` | Business logic for when to notify |
| `useNotifications.js` | React hooks for components |
| `README.md` | Full documentation |
| `INTEGRATION_*.md` | Component-specific guides |

## Common Patterns

### Display Unread Count
```javascript
const { unreadCount } = useNotifications(userId);
return <span>{unreadCount}</span>;
```

### Mark All as Read
```javascript
const { markAllAsRead } = useNotifications(userId);
return <button onClick={markAllAsRead}>Mark all as read</button>;
```

### Auto-refresh on New Notifications
```javascript
const { notifications } = useNotifications(userId);

useEffect(() => {
  if (notifications.some(n => n.type === 'complaint_approved')) {
    loadData();
  }
}, [notifications]);
```

### Lightweight Badge Only
```javascript
const { unreadCount } = useNotificationBell(userId);
return <span className="badge">{unreadCount}</span>;
```

## Troubleshooting

### Notifications not showing
1. Check database migration ran: `SELECT * FROM notifications;`
2. Verify user_id is correct: `SELECT * FROM auth.users;`
3. Check RLS policies: `SELECT * FROM pg_policies WHERE tablename='notifications';`

### Real-time not working
1. Enable Realtime in Supabase dashboard
2. Check browser console for errors
3. Verify user is authenticated

### FCM not sending
1. Verify Firebase project is configured
2. Check FCM token is stored in profiles
3. Ensure backend endpoint is accessible

## Next Steps

1. **Implement notification panel UI** - See INTEGRATION_*.md files
2. **Set up Firebase Cloud Messaging** - See README.md
3. **Add notification preferences** - Let users customize
4. **Add email notifications** - Extend notificationTriggers.js
5. **Monitor notification delivery** - Add analytics

## Support

For detailed documentation, see:
- `README.md` - Full architecture and setup
- `INTEGRATION_DIRECTOR.md` - Director dashboard integration
- `INTEGRATION_HEAD_INSPECTOR.md` - Head Inspector dashboard integration
- `INTEGRATION_INSPECTOR.md` - Inspector dashboard integration
