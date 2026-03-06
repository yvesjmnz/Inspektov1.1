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
 * Handles real-time updates via Supabase subscriptions, pagination, and user interactions.
 * 
 * SOLID: Single Responsibility - only manages notification UI state
 * 
 * Features:
 * - Real-time INSERT/UPDATE/DELETE events
 * - Optimistic UI updates
 * - Automatic unread count sync
 * - Fallback polling support
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
  const [isConnected, setIsConnected] = useState(true);

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
        // Optimistic update
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, status: 'read' } : n
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));

        // Persist to database
        await markAsRead(notificationId);
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
        // Revert optimistic update on error
        await loadUnread();
      }
    },
    [loadUnread]
  );

  // Mark all unread as read
  const handleMarkAllAsRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => n.status === 'unread')
      .map((n) => n.id);

    if (unreadIds.length === 0) return;

    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) =>
          unreadIds.includes(n.id) ? { ...n, status: 'read' } : n
        )
      );
      setUnreadCount(0);

      // Persist to database
      await markMultipleAsRead(unreadIds);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      // Revert optimistic update on error
      await loadUnread();
    }
  }, [notifications, loadUnread]);

  // Archive notification
  const handleArchive = useCallback(async (notificationId) => {
    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.filter((n) => n.id !== notificationId)
      );

      // Persist to database
      await archiveNotification(notificationId);
    } catch (err) {
      console.error('Failed to archive notification:', err);
      // Revert optimistic update on error
      await loadUnread();
    }
  }, [loadUnread]);

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

  // Handle real-time subscription events
  const handleRealtimeEvent = useCallback(
    (payload) => {
      const { event, new: newNotif, old: oldNotif } = payload;

      switch (event) {
        case 'INSERT':
          // Add new notification to the top
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
          break;

        case 'UPDATE':
          // Update existing notification
          setNotifications((prev) =>
            prev.map((n) => (n.id === newNotif.id ? newNotif : n))
          );
          // Adjust unread count if status changed
          if (oldNotif?.status === 'unread' && newNotif?.status !== 'unread') {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          } else if (oldNotif?.status !== 'unread' && newNotif?.status === 'unread') {
            setUnreadCount((prev) => prev + 1);
          }
          break;

        case 'DELETE':
          // Remove deleted notification
          setNotifications((prev) =>
            prev.filter((n) => n.id !== oldNotif.id)
          );
          if (oldNotif?.status === 'unread') {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
          break;

        default:
          break;
      }
    },
    []
  );

  // Set up real-time subscription
  useEffect(() => {
    if (!userId || !autoSubscribe || pollInterval) return;

    try {
      unsubscribeRef.current = subscribeToNotifications(userId, handleRealtimeEvent);
      setIsConnected(true);
    } catch (err) {
      console.error('Failed to subscribe to notifications:', err);
      setIsConnected(false);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [userId, autoSubscribe, pollInterval, handleRealtimeEvent]);

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
    isConnected,
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
