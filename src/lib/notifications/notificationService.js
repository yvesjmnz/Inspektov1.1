import { supabase } from '../supabase';

/**
 * NotificationService
 * 
 * Handles notification creation, storage, and retrieval.
 * Separates concerns: storage, messaging, and business logic.
 * 
 * SOLID Principles:
 * - Single Responsibility: Only manages notification lifecycle
 * - Open/Closed: Extensible for new notification types
 * - Dependency Inversion: Depends on supabase abstraction
 */

const NOTIFICATION_TYPES = {
  MISSION_ORDER_SUBMITTED: 'mission_order_submitted',
  COMPLAINT_APPROVED: 'complaint_approved',
  MISSION_ORDER_FOR_INSPECTION: 'mission_order_for_inspection',
};

const NOTIFICATION_STATUSES = {
  UNREAD: 'unread',
  READ: 'read',
  ARCHIVED: 'archived',
};

/**
 * Create a notification in the database
 * @param {Object} params
 * @param {string} params.userId - Target user ID
 * @param {string} params.type - Notification type (from NOTIFICATION_TYPES)
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message
 * @param {Object} params.metadata - Additional context (complaint_id, mission_order_id, etc.)
 * @param {string} params.fcmToken - Optional FCM token for push notification
 * @returns {Promise<Object>} Created notification record
 */
export async function createNotification({
  userId,
  type,
  title,
  message,
  metadata = {},
  fcmToken = null,
}) {
  if (!userId || !type || !title || !message) {
    throw new Error('Missing required notification fields: userId, type, title, message');
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert([
        {
          user_id: userId,
          type,
          title,
          message,
          metadata,
          status: NOTIFICATION_STATUSES.UNREAD,
          created_at: new Date().toISOString(),
          read_at: null,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // Send FCM push notification if token provided
    if (fcmToken) {
      await sendPushNotification({
        fcmToken,
        title,
        message,
        data: { notificationId: data.id, type, ...metadata },
      });
    }

    return data;
  } catch (err) {
    console.error('Failed to create notification:', err);
    throw err;
  }
}

/**
 * Send push notification via Firebase Cloud Messaging
 * @param {Object} params
 * @param {string} params.fcmToken - FCM device token
 * @param {string} params.title - Push notification title
 * @param {string} params.message - Push notification body
 * @param {Object} params.data - Additional data payload
 */
export async function sendPushNotification({
  fcmToken,
  title,
  message,
  data = {},
}) {
  try {
    // Call backend FCM endpoint (implement in your backend)
    const response = await fetch('/api/notifications/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fcmToken,
        title,
        message,
        data,
      }),
    });

    if (!response.ok) {
      throw new Error(`FCM request failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Failed to send push notification:', err);
    // Don't throw - push notifications are non-critical
  }
}

/**
 * Fetch unread notifications for a user
 * @param {string} userId - User ID
 * @param {number} limit - Max notifications to fetch
 * @returns {Promise<Array>} Array of unread notifications
 */
export async function getUnreadNotifications(userId, limit = 50) {
  if (!userId) throw new Error('userId is required');

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('status', NOTIFICATION_STATUSES.UNREAD)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to fetch unread notifications:', err);
    throw err;
  }
}

/**
 * Fetch all notifications for a user with pagination
 * @param {string} userId - User ID
 * @param {number} limit - Notifications per page
 * @param {number} offset - Pagination offset
 * @returns {Promise<Object>} { data: notifications[], count: total }
 */
export async function getNotifications(userId, limit = 20, offset = 0) {
  if (!userId) throw new Error('userId is required');

  try {
    const { data, error, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return { data: data || [], count: count || 0 };
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    throw err;
  }
}

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Updated notification
 */
export async function markAsRead(notificationId) {
  if (!notificationId) throw new Error('notificationId is required');

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({
        status: NOTIFICATION_STATUSES.READ,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to mark notification as read:', err);
    throw err;
  }
}

/**
 * Mark multiple notifications as read
 * @param {Array<string>} notificationIds - Array of notification IDs
 * @returns {Promise<Array>} Updated notifications
 */
export async function markMultipleAsRead(notificationIds) {
  if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
    throw new Error('notificationIds must be a non-empty array');
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({
        status: NOTIFICATION_STATUSES.READ,
        read_at: new Date().toISOString(),
      })
      .in('id', notificationIds)
      .select();

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Failed to mark notifications as read:', err);
    throw err;
  }
}

/**
 * Archive notification
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Updated notification
 */
export async function archiveNotification(notificationId) {
  if (!notificationId) throw new Error('notificationId is required');

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ status: NOTIFICATION_STATUSES.ARCHIVED })
      .eq('id', notificationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Failed to archive notification:', err);
    throw err;
  }
}

/**
 * Get unread notification count for a user
 * @param {string} userId - User ID
 * @returns {Promise<number>} Count of unread notifications
 */
export async function getUnreadCount(userId) {
  if (!userId) throw new Error('userId is required');

  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', NOTIFICATION_STATUSES.UNREAD);

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('Failed to get unread count:', err);
    throw err;
  }
}

/**
 * Subscribe to real-time notification updates for a user
 * @param {string} userId - User ID
 * @param {Function} callback - Called when notifications change
 * @returns {Function} Unsubscribe function
 */
export function subscribeToNotifications(userId, callback) {
  if (!userId || typeof callback !== 'function') {
    throw new Error('userId and callback function are required');
  }

  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        callback(payload);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}

export { NOTIFICATION_TYPES, NOTIFICATION_STATUSES };
