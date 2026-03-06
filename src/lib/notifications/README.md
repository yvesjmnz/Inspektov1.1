# Notifications Service Implementation Guide

## Overview

A clean, maintainable notifications service for Inspekto that integrates Firebase Cloud Messaging (FCM) with Supabase for persistent storage. Follows SOLID principles with clear separation of concerns.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Components                          │
│         (DashboardDirector, HeadInspector, Inspector)        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              useNotifications Hook                           │
│         (State management, real-time updates)                │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Notification │ │ Notification │ │ Notification │
│  Triggers    │ │   Service    │ │   Storage    │
│              │ │              │ │ (Supabase)   │
└──────────────┘ └──────────────┘ └──────────────┘
                         │
                         ▼
        ┌────────────────┬────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Firebase   │ │   Supabase   │ │   Database   │
│     FCM      │ │   Real-time  │ │ Persistence  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Components

### 1. **notificationService.js** - Core Service
Handles all notification operations:
- Create notifications
- Fetch notifications (unread, paginated)
- Mark as read/archived
- Real-time subscriptions
- FCM push notifications

**Key Functions:**
```javascript
createNotification(params)           // Create + store + push
getUnreadNotifications(userId)       // Fetch unread
getNotifications(userId, limit, offset) // Paginated fetch
markAsRead(notificationId)           // Mark single as read
markMultipleAsRead(ids)              // Batch mark as read
archiveNotification(id)              // Archive notification
getUnreadCount(userId)               // Get unread count
subscribeToNotifications(userId, cb) // Real-time updates
```

### 2. **notificationTriggers.js** - Business Logic
Domain-specific notification triggers:
- `notifyDirectorMissionOrderSubmitted()` - When MO submitted
- `notifyHeadInspectorComplaintApproved()` - When complaint approved
- `notifyInspectorMissionOrderAssigned()` - When MO assigned to inspector

### 3. **useNotifications.js** - React Hooks
Two hooks for component integration:

**useNotifications(userId, options)**
- Full notification management
- Real-time updates
- Pagination support
- Mark as read/archive actions

**useNotificationBell(userId)**
- Lightweight hook for badge/bell icon
- Just unread count
- Minimal re-renders

### 4. **Database Schema** (Supabase Migration)
```sql
notifications table:
- id (UUID, PK)
- user_id (FK to auth.users)
- type (VARCHAR) - notification type
- title (VARCHAR) - display title
- message (TEXT) - full message
- metadata (JSONB) - context data
- status (VARCHAR) - unread/read/archived
- created_at, read_at, archived_at (TIMESTAMPTZ)

notification_preferences table:
- user_id (FK)
- mission_order_notifications (BOOLEAN)
- complaint_notifications (BOOLEAN)
- inspection_notifications (BOOLEAN)
- email_notifications (BOOLEAN)
- push_notifications (BOOLEAN)
```

## Integration Steps

### Step 1: Run Database Migration
```bash
# Apply the migration to your Supabase project
supabase migration up
```

### Step 2: Update profiles table
Add FCM token storage to profiles:
```sql
ALTER TABLE profiles ADD COLUMN fcm_token VARCHAR(255);
```

### Step 3: Integrate into DashboardDirector

```javascript
import { useNotifications } from '../../../lib/notifications/useNotifications';
import { notifyHeadInspectorComplaintApproved } from '../../../lib/notifications/notificationTriggers';

export default function DashboardDirector() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    archive,
  } = useNotifications(currentUserId);

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

  // Render notification bell (see INTEGRATION_DIRECTOR.md for full UI)
  return (
    <div>
      <button onClick={() => setShowNotificationPanel(!showNotificationPanel)}>
        🔔 {unreadCount > 0 && <span>{unreadCount}</span>}
      </button>
      {/* Notification panel UI */}
    </div>
  );
}
```

### Step 4: Integrate into DashboardHeadInspector

```javascript
import { useNotifications } from '../../../lib/notifications/useNotifications';

export default function DashboardHeadInspector() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const { notifications, unreadCount, markAsRead } = useNotifications(currentUserId);

  // Auto-refresh when complaint approved notifications arrive
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

### Step 5: Integrate into DashboardInspector

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

## Firebase Cloud Messaging Setup

### 1. Create Backend Endpoint
Create `/api/notifications/send-push` endpoint:

```javascript
// Backend (Node.js/Express example)
app.post('/api/notifications/send-push', async (req, res) => {
  const { fcmToken, title, message, data } = req.body;

  try {
    const response = await admin.messaging().send({
      token: fcmToken,
      notification: { title, body: message },
      data: data,
      webpush: {
        fcmOptions: { link: '/dashboard' },
      },
    });
    res.json({ success: true, messageId: response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 2. Register FCM Token
In your app initialization:

```javascript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

const firebaseConfig = {
  // Your Firebase config
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// Get FCM token and store in profiles
getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' })
  .then((token) => {
    // Store token in profiles table
    supabase
      .from('profiles')
      .update({ fcm_token: token })
      .eq('id', userId);
  });
```

## Notification Types

```javascript
NOTIFICATION_TYPES = {
  MISSION_ORDER_SUBMITTED: 'mission_order_submitted',
  COMPLAINT_APPROVED: 'complaint_approved',
  MISSION_ORDER_FOR_INSPECTION: 'mission_order_for_inspection',
}
```

## Usage Examples

### Create a Notification
```javascript
import { createNotification, NOTIFICATION_TYPES } from './notificationService';

await createNotification({
  userId: 'director-id',
  type: NOTIFICATION_TYPES.MISSION_ORDER_SUBMITTED,
  title: 'New Mission Order',
  message: 'A new mission order has been submitted.',
  metadata: {
    mission_order_id: 'mo-123',
    complaint_id: 'c-456',
    business_name: 'ABC Corp',
  },
  fcmToken: 'fcm-token-here',
});
```

### Use in Component
```javascript
const { notifications, unreadCount, markAsRead } = useNotifications(userId);

// Mark as read
markAsRead(notificationId);

// Mark all as read
markAllAsRead();

// Archive
archive(notificationId);
```

### Real-time Updates
```javascript
// Automatically subscribes to real-time updates
const { notifications } = useNotifications(userId, { autoSubscribe: true });

// Or use polling instead
const { notifications } = useNotifications(userId, { pollInterval: 5000 });
```

## SOLID Principles Applied

### Single Responsibility
- **notificationService.js**: Only manages notification CRUD and storage
- **notificationTriggers.js**: Only handles business logic for when to notify
- **useNotifications.js**: Only manages React component state

### Open/Closed
- Easy to add new notification types without modifying existing code
- New triggers can be added to notificationTriggers.js

### Liskov Substitution
- Both hooks (useNotifications, useNotificationBell) can be used interchangeably

### Interface Segregation
- useNotificationBell for simple badge display
- useNotifications for full notification management

### Dependency Inversion
- Components depend on hooks, not directly on service
- Service depends on supabase abstraction

## Testing

See `__tests__/` directory for unit tests:
- notificationService.test.js
- notificationTriggers.test.js
- useNotifications.test.js

## Performance Considerations

1. **Real-time vs Polling**: Use real-time for active users, polling for background
2. **Pagination**: Load 20 notifications per page to avoid large payloads
3. **Indexes**: Database indexes on user_id, status, created_at for fast queries
4. **RLS**: Row-level security ensures users only see their notifications

## Future Enhancements

1. **Email Notifications**: Add email delivery option
2. **Notification Preferences**: Let users customize notification types
3. **Notification History**: Archive and search past notifications
4. **Batch Operations**: Bulk mark as read/archive
5. **Notification Templates**: Reusable message templates
6. **Analytics**: Track notification engagement

## Troubleshooting

### Notifications not appearing
1. Check FCM token is stored in profiles
2. Verify Firebase project configuration
3. Check browser console for errors
4. Ensure RLS policies allow notification creation

### Real-time updates not working
1. Verify Supabase real-time is enabled
2. Check network connection
3. Ensure user_id matches auth.uid()

### Performance issues
1. Reduce notification fetch limit
2. Enable pagination
3. Use useNotificationBell instead of useNotifications for badge only
4. Check database indexes are created
