/**
 * Push Notification Manager
 * 
 * Handles:
 * - Service Worker registration
 * - Push notification permissions
 * - FCM token management
 * - Browser push notification setup
 */

/**
 * Register service worker for push notifications
 * @returns {Promise<ServiceWorkerRegistration>}
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Workers not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      '/service-worker.js',
      { scope: '/' }
    );

    console.log('Service Worker registered successfully:', registration);
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    throw error;
  }
}

/**
 * Request push notification permission from user
 * @returns {Promise<NotificationPermission>}
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported in this browser');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission;
  }

  return Notification.permission;
}

/**
 * Check if push notifications are supported and enabled
 * @returns {boolean}
 */
export function isPushNotificationSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Notification.permission === 'granted'
  );
}

/**
 * Subscribe to push notifications
 * @param {ServiceWorkerRegistration} registration - Service Worker registration
 * @param {string} vapidPublicKey - VAPID public key from Firebase
 * @returns {Promise<PushSubscription>}
 */
export async function subscribeToPushNotifications(registration, vapidPublicKey) {
  if (!registration || !vapidPublicKey) {
    throw new Error('Registration and VAPID key are required');
  }

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    console.log('Push subscription successful:', subscription);
    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
    throw error;
  }
}

/**
 * Get existing push subscription
 * @param {ServiceWorkerRegistration} registration - Service Worker registration
 * @returns {Promise<PushSubscription|null>}
 */
export async function getPushSubscription(registration) {
  if (!registration) return null;

  try {
    return await registration.pushManager.getSubscription();
  } catch (error) {
    console.error('Failed to get push subscription:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications
 * @param {PushSubscription} subscription - Push subscription
 * @returns {Promise<boolean>}
 */
export async function unsubscribeFromPushNotifications(subscription) {
  if (!subscription) return false;

  try {
    const success = await subscription.unsubscribe();
    console.log('Push unsubscription successful:', success);
    return success;
  } catch (error) {
    console.error('Failed to unsubscribe from push notifications:', error);
    throw error;
  }
}

/**
 * Send push subscription to server for storage
 * @param {PushSubscription} subscription - Push subscription
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
export async function savePushSubscriptionToServer(subscription, userId) {
  if (!subscription || !userId) {
    throw new Error('Subscription and userId are required');
  }

  try {
    const response = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        subscription: subscription.toJSON(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save subscription: ${response.statusText}`);
    }

    console.log('Push subscription saved to server');
  } catch (error) {
    console.error('Failed to save push subscription:', error);
    throw error;
  }
}

/**
 * Initialize push notifications for user
 * Complete setup: register SW, request permission, subscribe, save
 * @param {string} userId - User ID
 * @param {string} vapidPublicKey - VAPID public key
 * @returns {Promise<boolean>} - Success status
 */
export async function initializePushNotifications(userId, vapidPublicKey) {
  try {
    // Check browser support
    if (!isPushNotificationSupported() && !('serviceWorker' in navigator)) {
      console.warn('Push notifications not supported');
      return false;
    }

    // Register service worker
    const registration = await registerServiceWorker();
    if (!registration) return false;

    // Request permission
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission denied');
      return false;
    }

    // Check for existing subscription
    let subscription = await getPushSubscription(registration);

    // Subscribe if not already subscribed
    if (!subscription && vapidPublicKey) {
      subscription = await subscribeToPushNotifications(registration, vapidPublicKey);
    }

    // Save subscription to server
    if (subscription) {
      await savePushSubscriptionToServer(subscription, userId);
    }

    console.log('Push notifications initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize push notifications:', error);
    return false;
  }
}

/**
 * Show a test notification
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @returns {Promise<void>}
 */
export async function showTestNotification(title, message) {
  if (!isPushNotificationSupported()) {
    throw new Error('Push notifications not supported');
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body: message,
      icon: '/logo.png',
      badge: '/logo.png',
    });
  } catch (error) {
    console.error('Failed to show test notification:', error);
    throw error;
  }
}

/**
 * Convert VAPID key from base64 to Uint8Array
 * @param {string} base64String - Base64 encoded VAPID key
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Get notification permission status
 * @returns {NotificationPermission}
 */
export function getNotificationPermissionStatus() {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Check if user has granted notification permission
 * @returns {boolean}
 */
export function hasNotificationPermission() {
  return getNotificationPermissionStatus() === 'granted';
}

/**
 * Listen for service worker messages
 * Useful for handling notification interactions
 * @param {Function} callback - Called with message data
 * @returns {Function} - Unsubscribe function
 */
export function onServiceWorkerMessage(callback) {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const handleMessage = (event) => {
    if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
      callback(event.data);
    }
  };

  navigator.serviceWorker.addEventListener('message', handleMessage);

  return () => {
    navigator.serviceWorker.removeEventListener('message', handleMessage);
  };
}

export default {
  registerServiceWorker,
  requestNotificationPermission,
  isPushNotificationSupported,
  subscribeToPushNotifications,
  getPushSubscription,
  unsubscribeFromPushNotifications,
  savePushSubscriptionToServer,
  initializePushNotifications,
  showTestNotification,
  getNotificationPermissionStatus,
  hasNotificationPermission,
  onServiceWorkerMessage,
};
