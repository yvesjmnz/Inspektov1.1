// supabase/functions/verify-business-proximity/index.ts
//
// Phase: Location-Based Authenticity (Business proximity via address geocoding)
//
// Responsibility:
// - Load business address from public.businesses by business_pk
// - Geocode address via Google Geocoding API (server-side; key not exposed to client)
// - Compute distance from reporter device coordinates
// - Return tag + distance + resolved business coords
//
// Notes:
// - Uses SUPABASE_SERVICE_ROLE_KEY so it can read businesses regardless of RLS.
// - Requires GOOGLE_MAPS_API_KEY set in Edge Function environment variables.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type VerifyRequest = {
  business_pk?: number | null;
  business_address?: string;
  reporter_lat: number;
  reporter_lng: number;
  threshold_meters?: number;
};

type VerifyResponse =
  | {
      ok: true;
      tag: 'Location Verified' | 'Failed Location Verification';
      distance_meters: number;
      threshold_meters: number;
      business_coords: { lat: number; lng: number };
      business_address: string;
    }
  | { ok: false; error: string };

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getSupabaseClient(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function geocodeGoogle(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new Error('Missing GOOGLE_MAPS_API_KEY');

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    status?: string;
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    error_message?: string;
  };

  if (json.status !== 'OK' || !json.results || json.results.length === 0) {
    return null;
  }

  const loc = json.results[0]?.geometry?.location;
  const lat = loc?.lat;
  const lng = loc?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return { lat, lng };
}

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    if (req.method !== 'POST') {
      const res: VerifyResponse = { ok: false, error: 'Method not allowed' };
      return new Response(JSON.stringify(res), {
        status: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const body = (await req.json()) as Partial<VerifyRequest>;
    const businessPk = body.business_pk;
    const userProvidedAddress = body.business_address;
    const reporterLat = body.reporter_lat;
    const reporterLng = body.reporter_lng;
    const threshold = typeof body.threshold_meters === 'number' ? body.threshold_meters : 200;

    if (typeof reporterLat !== 'number' || typeof reporterLng !== 'number') {
      const res: VerifyResponse = { ok: false, error: 'Missing reporter coordinates' };
      return new Response(JSON.stringify(res), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    let address: string;

    // If user provided an address directly (no-permit case), use it
    if (typeof userProvidedAddress === 'string' && userProvidedAddress.trim().length > 0) {
      address = String(userProvidedAddress).trim();
    } else if (typeof businessPk === 'number') {
      // Otherwise, fetch from database using business_pk
      const supabase = getSupabaseClient(req);
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('business_address')
        .eq('business_pk', businessPk)
        .single();

      if (businessError || !business?.business_address) {
        const res: VerifyResponse = { ok: false, error: 'Unable to load business address' };
        return new Response(JSON.stringify(res), {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        });
      }

      address = String(business.business_address).trim();
    } else {
      const res: VerifyResponse = { ok: false, error: 'Missing business_pk or business_address' };
      return new Response(JSON.stringify(res), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    if (address.length < 5) {
      const res: VerifyResponse = { ok: false, error: 'Business address is missing or too short' };
      return new Response(JSON.stringify(res), {
        status: 422,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const coords = await geocodeGoogle(address);
    if (!coords) {
      const res: VerifyResponse = { ok: false, error: 'Unable to geocode business address' };
      return new Response(JSON.stringify(res), {
        status: 422,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    // Persist resolved business coordinates for future lookups (best effort)
    try {
      await supabase
        .from('businesses')
        .update({
          business_lat: coords.lat,
          business_lng: coords.lng,
        })
        .eq('business_pk', businessPk);
    } catch {
      // Ignore persistence failures; proximity result can still be returned.
    }

    const distance = haversineMeters(
      { latitude: reporterLat, longitude: reporterLng },
      { latitude: coords.lat, longitude: coords.lng }
    );

    const tag: VerifyResponse & { ok: true }['tag'] =
      distance <= threshold ? 'Location Verified' : 'Failed Location Verification';

    const res: VerifyResponse = {
      ok: true,
      tag,
      distance_meters: distance,
      threshold_meters: threshold,
      business_coords: coords,
      business_address: address,
    };

    return new Response(JSON.stringify(res), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    const res: VerifyResponse = { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    return new Response(JSON.stringify(res), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
});
