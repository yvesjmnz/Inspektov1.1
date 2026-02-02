import { supabase } from './supabase';

export async function requestEmailVerification(email, complaintId = null, turnstileToken = null) {
  const { data, error } = await supabase.functions.invoke('request-email-verification', {
    body: {
      email,
      complaintId,
      turnstileToken,
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
