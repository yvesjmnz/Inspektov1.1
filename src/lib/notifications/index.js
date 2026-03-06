/**
 * Notifications Module Index
 * 
 * Central export point for all notification utilities
 * Simplifies imports across the application
 */

// Core service
export {
  createNotification,
  sendPushNotification,
  getUnreadNotifications,
  getNotifications,
  markAsRead,
  markMultipleAsRead,
  archiveNotification,
  getUnreadCount,
  subscribeToNotifications,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES,
} from './notificationService';

// Business logic triggers
export {
  notifyDirectorMissionOrderSubmitted,
  notifyHeadInspectorComplaintApproved,
  notifyInspectorMissionOrderAssigned,
  notifyInspectorsMissionOrderAssigned,
} from './notificationTriggers';

// React hooks
export {
  useNotifications,
  useNotificationBell,
} from './useNotifications';
