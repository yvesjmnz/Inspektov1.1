/**
 * Service Worker for Push Notifications
 * 
 * Handles:
 * - Push notification events
 * - Notification clicks
 * - Background sync
 * - Offline support
 */

const CACHE_NAME = 'inspekto-app-shell-v1';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/bg.jpg',
  '/CityHall.jpg',
  '/logo.png',
  '/seal-manila.png',
  '/manila.png',
  '/bureau-permits.png',
  '/cropped-bureau.png',
  '/refresh.png',
  '/ui_icons/Address.png',
  '/ui_icons/Business.png',
  '/ui_icons/camera.png',
  '/ui_icons/Complaint%20Description.png',
  '/ui_icons/document.png',
  '/ui_icons/history.png',
  '/ui_icons/image.png',
  '/ui_icons/inspection.png',
  '/ui_icons/logout.png',
  '/ui_icons/menu.png',
  '/ui_icons/mo.png',
  '/ui_icons/queue.png',
  '/ui_icons/revision.png',
  '/ui_icons/special-clipboard-check.svg',
  '/ui_icons/special-envelope.svg',
  '/ui_icons/special-secure-envelope.svg',
  '/ui_icons/special-shield-check.svg',
  '/ui_icons/switch-camera.png',
  '/ui_icons/task.png',
  '/ui_icons/user.png',
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL_URLS.map((url) => cache.add(url)));
}

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
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      clients.claim(),
    ])
  );
});

// Handle service worker installation
self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

// Cache same-origin app assets so tablets can reopen the inspection slip offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          const fallback = cached || (await caches.match('/'));
          return (
            fallback ||
            new Response('Inspection Slip is offline and the app shell is not cached yet.', {
              status: 503,
              statusText: 'Offline',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(async (cached) => {
      if (cached) return cached;

      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      } catch {
        return new Response('', {
          status: 503,
          statusText: 'Offline',
        });
      }
    })
  );
});
