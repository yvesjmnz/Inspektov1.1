import { createNotification, NOTIFICATION_TYPES } from './notificationService';
import { supabase } from '../supabase';

/**
 * NotificationTriggers
 * 
 * Business logic for triggering notifications based on domain events.
 * Keeps notification creation logic separate from UI concerns.
 * 
 * SOLID: Single Responsibility - each function handles one notification scenario
 */

/**
 * Notify Director when a new mission order is submitted
 * @param {string} missionOrderId - Mission order ID
 * @param {string} complaintId - Associated complaint ID
 * @param {string} businessName - Business name for context
 */
export async function notifyDirectorMissionOrderSubmitted(
  missionOrderId,
  complaintId,
  businessName
) {
  try {
    // Get Director role users (implement based on your role system)
    const { data: directors, error: directorError } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('role', 'director');

    if (directorError) throw directorError;

    if (!directors || directors.length === 0) {
      console.warn('No active directors found for notification');
      return;
    }

    // Create notification for each director
    const notifications = directors.map((director) =>
      createNotification({
        userId: director.id,
        type: NOTIFICATION_TYPES.MISSION_ORDER_SUBMITTED,
        title: 'New Mission Order Submitted',
        message: `A new mission order for "${businessName}" has been submitted for your review.`,
        metadata: {
          mission_order_id: missionOrderId,
          complaint_id: complaintId,
          business_name: businessName,
        },
        fcmToken: director.fcm_token,
      })
    );

    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify director of mission order submission:', err);
    throw err;
  }
}

/**
 * Notify Head Inspector when a complaint is approved for mission order creation
 * @param {string} complaintId - Complaint ID
 * @param {string} businessName - Business name for context
 */
export async function notifyHeadInspectorComplaintApproved(
  complaintId,
  businessName
) {
  try {
    // Get Head Inspector role users
    const { data: headInspectors, error: hiError } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('role', 'head_inspector');

    if (hiError) throw hiError;

    if (!headInspectors || headInspectors.length === 0) {
      console.warn('No active head inspectors found for notification');
      return;
    }

    // Create notification for each head inspector
    const notifications = headInspectors.map((hi) =>
      createNotification({
        userId: hi.id,
        type: NOTIFICATION_TYPES.COMPLAINT_APPROVED,
        title: 'Complaint Approved for Mission Order',
        message: `A complaint for "${businessName}" has been approved. You can now create a mission order.`,
        metadata: {
          complaint_id: complaintId,
          business_name: businessName,
        },
        fcmToken: hi.fcm_token,
      })
    );

    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify head inspector of complaint approval:', err);
    throw err;
  }
}

/**
 * Notify Head Inspector when a mission order is approved by director
 * @param {string} missionOrderId - Mission order ID
 * @param {string} businessName - Business name for context
 */
export async function notifyHeadInspectorMissionOrderApproved(
  missionOrderId,
  businessName
) {
  try {
    // Get Head Inspector role users
    const { data: headInspectors, error: hiError } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('role', 'head_inspector');

    if (hiError) throw hiError;

    if (!headInspectors || headInspectors.length === 0) {
      console.warn('No head inspectors found for notification');
      return;
    }

    // Create notification for each head inspector
    const notifications = headInspectors.map((hi) =>
      createNotification({
        userId: hi.id,
        type: 'mission_order_approved',
        title: 'Mission Order Approved',
        message: `The mission order for "${businessName}" has been approved by the Director and is ready for inspection.`,
        metadata: {
          mission_order_id: missionOrderId,
          business_name: businessName,
        },
        fcmToken: hi.fcm_token,
      })
    );

    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify head inspector of mission order approval:', err);
    throw err;
  }
}

/**
 * Notify Head Inspector when a mission order is rejected by director
 * @param {string} missionOrderId - Mission order ID
 * @param {string} businessName - Business name for context
 * @param {string} directorComment - Reason for rejection
 */
export async function notifyHeadInspectorMissionOrderRejected(
  missionOrderId,
  businessName,
  directorComment
) {
  try {
    // Get Head Inspector role users
    const { data: headInspectors, error: hiError } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('role', 'head_inspector');

    if (hiError) throw hiError;

    if (!headInspectors || headInspectors.length === 0) {
      console.warn('No head inspectors found for notification');
      return;
    }

    // Create notification for each head inspector
    const notifications = headInspectors.map((hi) =>
      createNotification({
        userId: hi.id,
        type: 'mission_order_rejected',
        title: 'Mission Order Rejected',
        message: `The mission order for "${businessName}" has been rejected by the Director.`,
        metadata: {
          mission_order_id: missionOrderId,
          business_name: businessName,
          director_comment: directorComment || '',
        },
        fcmToken: hi.fcm_token,
      })
    );

    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify head inspector of mission order rejection:', err);
    throw err;
  }
}

/**
 * Notify Inspector when a mission order is assigned for inspection
 * @param {string} missionOrderId - Mission order ID
 * @param {string} inspectorId - Inspector user ID
 * @param {string} businessName - Business name for context
 */
export async function notifyInspectorMissionOrderAssigned(
  missionOrderId,
  inspectorId,
  businessName
) {
  try {
    // Get inspector's FCM token
    const { data: inspector, error: inspectorError } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('id', inspectorId)
      .single();

    if (inspectorError) throw inspectorError;

    if (!inspector) {
      console.warn(`Inspector ${inspectorId} not found`);
      return;
    }

    await createNotification({
      userId: inspectorId,
      type: NOTIFICATION_TYPES.MISSION_ORDER_FOR_INSPECTION,
      title: 'New Mission Order Assigned',
      message: `You have been assigned to inspect "${businessName}".`,
      metadata: {
        mission_order_id: missionOrderId,
        business_name: businessName,
      },
      fcmToken: inspector.fcm_token,
    });
  } catch (err) {
    console.error('Failed to notify inspector of mission order assignment:', err);
    throw err;
  }
}

/**
 * Notify multiple inspectors when a mission order is assigned to them
 * @param {string} missionOrderId - Mission order ID
 * @param {Array<string>} inspectorIds - Array of inspector user IDs
 * @param {string} businessName - Business name for context
 */
export async function notifyInspectorsMissionOrderAssigned(
  missionOrderId,
  inspectorIds,
  businessName
) {
  if (!Array.isArray(inspectorIds) || inspectorIds.length === 0) {
    throw new Error('inspectorIds must be a non-empty array');
  }

  try {
    const notifications = inspectorIds.map((inspectorId) =>
      notifyInspectorMissionOrderAssigned(missionOrderId, inspectorId, businessName)
    );

    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify inspectors of mission order assignment:', err);
    throw err;
  }
}

export {
  NOTIFICATION_TYPES,
};
