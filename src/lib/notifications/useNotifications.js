import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getUnreadNotifications,
  getNotifications,
  markAsRead,
  markMultipleAsRead,
  archiveNotification,
  getUnreadCount,
  subscribeToNotifications,
} from './notificationService';

/**
 * useNotifications Hook
 * 
 * Manages notification state and lifecycle for React components.
 * Handles real-time updates, pagination, and user interactions.
 * 
 * SOLID: Single Responsibility - only manages notification UI state
 */

export function useNotifications(userId, options = {}) {
  const {
    autoSubscribe = true,
    pollInterval = null, // Set to ms value to enable polling instead of real-time
  } = options;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const unsubscribeRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Load unread notifications
  const loadUnread = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await getUnreadNotifications(userId, 50);
      setNotifications(data);
      setUnreadCount(data.length);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load unread notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Load paginated notifications
  const loadMore = useCallback(async () => {
    if (!userId || !hasMore) return;

    try {
      setLoading(true);
      const { data, count } = await getNotifications(userId, 20, page * 20);
      setNotifications((prev) => [...prev, ...data]);
      setHasMore(data.length === 20);
      setPage((prev) => prev + 1);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load more notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, page, hasMore]);

  // Mark single notification as read
  const handleMarkAsRead = useCallback(
    async (notificationId) => {
      try {
        await markAsRead(notificationId);
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, status: 'read' } : n
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    },
    []
  );

  // Mark all unread as read
  const handleMarkAllAsRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => n.status === 'unread')
      .map((n) => n.id);

    if (unreadIds.length === 0) return;

    try {
      await markMultipleAsRead(unreadIds);
      setNotifications((prev) =>
        prev.map((n) =>
          unreadIds.includes(n.id) ? { ...n, status: 'read' } : n
        )
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  }, [notifications]);

  // Archive notification
  const handleArchive = useCallback(async (notificationId) => {
    try {
      await archiveNotification(notificationId);
      setNotifications((prev) =>
        prev.filter((n) => n.id !== notificationId)
      );
    } catch (err) {
      console.error('Failed to archive notification:', err);
    }
  }, []);

  // Refresh unread count
  const refreshCount = useCallback(async () => {
    if (!userId) return;

    try {
      const count = await getUnreadCount(userId);
      setUnreadCount(count);
    } catch (err) {
      console.error('Failed to refresh unread count:', err);
    }
  }, [userId]);

  // Set up real-time subscription
  useEffect(() => {
    if (!userId || !autoSubscribe || pollInterval) return;

    try {
      unsubscribeRef.current = subscribeToNotifications(userId, (payload) => {
        // Reload unread on any change
        loadUnread();
      });
    } catch (err) {
      console.error('Failed to subscribe to notifications:', err);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [userId, autoSubscribe, pollInterval, loadUnread]);

  // Set up polling if specified
  useEffect(() => {
    if (!userId || !pollInterval) return;

    pollIntervalRef.current = setInterval(() => {
      refreshCount();
    }, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [userId, pollInterval, refreshCount]);

  // Initial load
  useEffect(() => {
    loadUnread();
  }, [userId, loadUnread]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    loadMore,
    loadUnread,
    markAsRead: handleMarkAsRead,
    markAllAsRead: handleMarkAllAsRead,
    archive: handleArchive,
    refreshCount,
  };
}

/**
 * useNotificationBell Hook
 * 
 * Simplified hook for displaying notification badge/bell icon.
 * Minimal state management for performance.
 */
export function useNotificationBell(userId) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const loadCount = async () => {
      try {
        setLoading(true);
        const count = await getUnreadCount(userId);
        setUnreadCount(count);
      } catch (err) {
        console.error('Failed to load unread count:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCount();

    // Subscribe to real-time updates
    const unsubscribe = subscribeToNotifications(userId, () => {
      loadCount();
    });

    return () => unsubscribe();
  }, [userId]);

  return { unreadCount, loading };
}
