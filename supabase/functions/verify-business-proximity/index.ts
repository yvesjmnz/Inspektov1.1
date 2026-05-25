// supabase/functions/verify-business-proximity/index.ts
//
// Phase: Location-Based Authenticity (Business proximity via address geocoding)
//
// Responsibility:
// - Load business address from public.businesses by business_pk
// - Geocode address via geocode.maps.co (server-side; key not exposed to client)
// - Compute distance from reporter device coordinates when available
// - Return resolved business coords plus Manila City jurisdiction metadata
//
// Notes:
// - Uses SUPABASE_SERVICE_ROLE_KEY so it can read businesses regardless of RLS.
// - Requires GEOCODE_MAPS_API_KEY in Edge Function environment variables.
// - Also accepts legacy GOOGLE_MAPS_API_KEY during migration.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { forwardGeocodeAddress } from '../_shared/geocodeMaps.ts';

type VerifyRequest = {
  business_pk?: number | null;
  business_address?: string;
  reporter_lat?: number;
  reporter_lng?: number;
  threshold_meters?: number;
};

type VerifyResponse =
  | {
      ok: true;
      business_coords: { lat: number; lng: number };
      business_address: string;
      resolved_address: string;
      resolved_locality: string | null;
      within_manila_city: boolean;
      tag?: 'Location Verified' | 'Failed Location Verification';
      distance_meters?: number;
      threshold_meters?: number;
    }
  | { ok: false; error: string };

type GeocodeResult = {
  lat: number;
  lng: number;
  formatted_address: string;
  address: Record<string, string | undefined>;
};

const MANILA_CITY_NAMES = new Set(['manila', 'city of manila', 'maynila']);
const METRO_MANILA_NAMES = new Set([
  'metro manila',
  'metropolitan manila',
  'national capital region',
  'ncr',
]);
const MANILA_CITY_BOUNDS = {
  minLat: 14.54,
  maxLat: 14.71,
  minLng: 120.95,
  maxLng: 121.03,
};

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

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const result = await forwardGeocodeAddress(address);
  if (!result) return null;

  return {
    lat: result.lat,
    lng: result.lng,
    formatted_address: result.formatted_address,
    address: result.address,
  };
}

function normalizeName(value: string | undefined | null) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function getAddressFieldValues(result: GeocodeResult, fields: string[]) {
  return fields
    .map((field) => result.address?.[field])
    .map((value) => normalizeName(value))
    .filter(Boolean);
}

function isInsideManilaBounds(lat: number, lng: number) {
  return (
    lat >= MANILA_CITY_BOUNDS.minLat &&
    lat <= MANILA_CITY_BOUNDS.maxLat &&
    lng >= MANILA_CITY_BOUNDS.minLng &&
    lng <= MANILA_CITY_BOUNDS.maxLng
  );
}

function resolveJurisdiction(result: GeocodeResult) {
  const localities = [
    ...getAddressFieldValues(result, ['city', 'municipality', 'town', 'village', 'hamlet']),
    ...getAddressFieldValues(result, ['suburb', 'city_district', 'borough', 'quarter']),
    ...getAddressFieldValues(result, ['county']),
  ];
  const adminRegions = [
    ...getAddressFieldValues(result, ['state', 'region', 'province', 'state_district']),
    ...getAddressFieldValues(result, ['county']),
  ];

  const resolvedLocality = localities.find(Boolean) || null;
  const localityMatchesManila = localities.some((value) => MANILA_CITY_NAMES.has(value));
  const regionIsMetroManila = adminRegions.some((value) => METRO_MANILA_NAMES.has(value));
  const withinBounds = isInsideManilaBounds(result.lat, result.lng);

  return {
    resolvedLocality,
    withinManilaCity: localityMatchesManila || (withinBounds && (regionIsMetroManila || !resolvedLocality)),
  };
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
    const hasReporterCoords = typeof reporterLat === 'number' && typeof reporterLng === 'number';

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

    const geocode = await geocodeAddress(address);
    if (!geocode) {
      const res: VerifyResponse = { ok: false, error: 'Unable to geocode business address' };
      return new Response(JSON.stringify(res), {
        status: 422,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    // // Persist resolved business coordinates for future lookups (best effort)
    // try {
    //   await supabase
    //     .from('businesses')
    //     .update({
    //       business_lat: coords.lat,
    //       business_lng: coords.lng,
    //     })
    //     .eq('business_pk', businessPk);
    // } catch {
    //   // Ignore persistence failures; proximity result can still be returned.
    // }

    const jurisdiction = resolveJurisdiction(geocode);

    const res: Extract<VerifyResponse, { ok: true }> = {
      ok: true,
      business_coords: { lat: geocode.lat, lng: geocode.lng },
      business_address: address,
      resolved_address: geocode.formatted_address || address,
      resolved_locality: jurisdiction.resolvedLocality,
      within_manila_city: jurisdiction.withinManilaCity,
    };

    if (hasReporterCoords) {
      const distance = haversineMeters(
        { latitude: reporterLat, longitude: reporterLng },
        { latitude: geocode.lat, longitude: geocode.lng }
      );

      res.tag = distance <= threshold ? 'Location Verified' : 'Failed Location Verification';
      res.distance_meters = distance;
      res.threshold_meters = threshold;
    }

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
