import { supabase } from './supabase';

export async function requestEmailVerification(email, complaintId = null, turnstileToken = null, formType = 'complaint') {
  const { data, error } = await supabase.functions.invoke('request-email-verification', {
    body: {
      email,
      complaintId,
      turnstileToken,
      formType,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to request email verification');
  }

  return data;
}

export async function verifyEmail(token) {
  const { data, error } = await supabase.functions.invoke('verify-email', {
    body: { token },
  });

  if (error) {
    throw new Error(error.message || 'Failed to verify email');
  }

  return data;
}

/**
 * Cancel an inspection for a Mission Order.
 * - Sets status to 'cancelled' only if the MO is currently marked for inspection.
 * - Optionally accepts a reason string (not stored unless your DB has a cancel_reason column).
 *
 * Returns the updated row (id, status).
 */
export async function cancelInspection(missionOrderId, reason = '') {
  if (!missionOrderId) throw new Error('missionOrderId is required');

  // Ensure the user session is valid (frontend-side guard)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error('You must be logged in to cancel an inspection.');
  }

  // Update only rows that are currently flagged for inspection
  const { data, error } = await supabase
    .from('mission_orders')
    .update({ status: 'cancelled' })
    .eq('id', missionOrderId)
    .in('status', ['for inspection', 'for_inspection'])
    .select('id, status')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to cancel inspection.');
  }

  return data;
}
