/**
 * Service Worker for Push Notifications
 * 
 * Handles:
 * - Push notification events
 * - Notification clicks
 * - Background sync
 * - Offline support
 */

// Listen for push notifications
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('Push notification received with no data');
    return;
  }

  try {
    const data = event.data.json();
    const { title, message, data: metadata } = data;

    const options = {
      body: message,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: metadata?.notificationId || 'notification',
      requireInteraction: false,
      data: metadata || {},
      actions: [
        {
          action: 'open',
          title: 'Open',
        },
        {
          action: 'close',
          title: 'Close',
        },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(title || 'Notification', options)
    );
  } catch (error) {
    console.error('Error handling push notification:', error);
  }
});

// Listen for notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action, notification } = event;
  const { data } = notification;

  if (action === 'close') {
    return;
  }

  // Handle notification click - navigate to relevant page
  const url = getUrlForNotification(data);

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if window is already open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if not found
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Listen for notification close
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification.tag);
});

// Handle background sync for offline notifications
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

/**
 * Determine URL based on notification type
 * @param {Object} data - Notification metadata
 * @returns {string} URL to navigate to
 */
function getUrlForNotification(data) {
  const baseUrl = self.location.origin;

  if (!data) {
    return baseUrl;
  }

  const { type, mission_order_id, complaint_id, inspection_id } = data;

  switch (type) {
    case 'mission_order_submitted':
    case 'mission_order_approved':
    case 'mission_order_rejected':
      return `${baseUrl}/mission-order?id=${mission_order_id}`;

    case 'complaint_approved':
      return `${baseUrl}/complaints/view?id=${complaint_id}`;

    case 'mission_order_for_inspection':
      return `${baseUrl}/mission-order?id=${mission_order_id}`;

    case 'inspection_completed':
      return `${baseUrl}/inspections/view?id=${inspection_id}`;

    default:
      return baseUrl;
  }
}

/**
 * Sync notifications when coming back online
 */
async function syncNotifications() {
  try {
    // This would typically fetch pending notifications from server
    // and display them to the user
    console.log('Syncing notifications...');
  } catch (error) {
    console.error('Failed to sync notifications:', error);
    throw error;
  }
}

// Handle service worker activation
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(clients.claim());
});

// Handle service worker installation
self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});
