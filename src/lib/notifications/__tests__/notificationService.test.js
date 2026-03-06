/**
 * notificationService.test.js
 * 
 * Unit tests for notification service
 * Demonstrates proper testing patterns for the service layer
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createNotification,
  getUnreadNotifications,
  markAsRead,
  getUnreadCount,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES,
} from './notificationService';

// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create a notification with required fields', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'notif-1',
              user_id: 'user-1',
              type: NOTIFICATION_TYPES.MISSION_ORDER_SUBMITTED,
              title: 'Test',
              message: 'Test message',
              status: NOTIFICATION_STATUSES.UNREAD,
            },
            error: null,
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ insert: mockInsert });

      const result = await createNotification({
        userId: 'user-1',
        type: NOTIFICATION_TYPES.MISSION_ORDER_SUBMITTED,
        title: 'Test',
        message: 'Test message',
      });

      expect(result.id).toBe('notif-1');
      expect(result.status).toBe(NOTIFICATION_STATUSES.UNREAD);
    });

    it('should throw error if required fields are missing', async () => {
      await expect(
        createNotification({
          userId: 'user-1',
          // missing type, title, message
        })
      ).rejects.toThrow('Missing required notification fields');
    });

    it('should include metadata in notification', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'notif-1' },
            error: null,
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ insert: mockInsert });

      const metadata = { complaint_id: 'c-1', business_name: 'Test Corp' };
      await createNotification({
        userId: 'user-1',
        type: NOTIFICATION_TYPES.COMPLAINT_APPROVED,
        title: 'Test',
        message: 'Test message',
        metadata,
      });

      const insertCall = mockInsert.mock.calls[0][0][0];
      expect(insertCall.metadata).toEqual(metadata);
    });
  });

  describe('getUnreadNotifications', () => {
    it('should fetch unread notifications for a user', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [
                  { id: 'notif-1', status: NOTIFICATION_STATUSES.UNREAD },
                  { id: 'notif-2', status: NOTIFICATION_STATUSES.UNREAD },
                ],
                error: null,
              }),
            }),
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ select: mockSelect });

      const result = await getUnreadNotifications('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(NOTIFICATION_STATUSES.UNREAD);
    });

    it('should throw error if userId is missing', async () => {
      await expect(getUnreadNotifications(null)).rejects.toThrow(
        'userId is required'
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'notif-1',
                status: NOTIFICATION_STATUSES.READ,
                read_at: '2024-01-01T00:00:00Z',
              },
              error: null,
            }),
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ update: mockUpdate });

      const result = await markAsRead('notif-1');

      expect(result.status).toBe(NOTIFICATION_STATUSES.READ);
      expect(result.read_at).toBeDefined();
    });

    it('should throw error if notificationId is missing', async () => {
      await expect(markAsRead(null)).rejects.toThrow(
        'notificationId is required'
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            count: 5,
            error: null,
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ select: mockSelect });

      const result = await getUnreadCount('user-1');

      expect(result).toBe(5);
    });

    it('should return 0 if no unread notifications', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            count: 0,
            error: null,
          }),
        }),
      });

      const { supabase } = await import('../supabase');
      supabase.from.mockReturnValue({ select: mockSelect });

      const result = await getUnreadCount('user-1');

      expect(result).toBe(0);
    });
  });

  describe('NOTIFICATION_TYPES', () => {
    it('should have all required notification types', () => {
      expect(NOTIFICATION_TYPES.MISSION_ORDER_SUBMITTED).toBeDefined();
      expect(NOTIFICATION_TYPES.COMPLAINT_APPROVED).toBeDefined();
      expect(NOTIFICATION_TYPES.MISSION_ORDER_FOR_INSPECTION).toBeDefined();
    });
  });

  describe('NOTIFICATION_STATUSES', () => {
    it('should have all required statuses', () => {
      expect(NOTIFICATION_STATUSES.UNREAD).toBe('unread');
      expect(NOTIFICATION_STATUSES.READ).toBe('read');
      expect(NOTIFICATION_STATUSES.ARCHIVED).toBe('archived');
    });
  });
});
