// Shared token utilities for Supabase Edge Functions (Deno)

/**
 * Generate a URL-safe random token.
 * Uses Web Crypto for strong randomness.
 */
export function generateToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  // Base64-url encode
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Hash token with SHA-256 and return hex string.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function nowPlusMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}
