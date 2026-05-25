type GeocodeMapsSearchItem = {
  lat?: string | number;
  lon?: string | number;
  display_name?: string;
  address?: Record<string, string | undefined>;
};

export type ForwardGeocodeResult = {
  lat: number;
  lng: number;
  formatted_address: string;
  address: Record<string, string | undefined>;
};

function getApiKey() {
  const apiKey =
    Deno.env.get('GEOCODE_MAPS_API_KEY') ||
    Deno.env.get('GOOGLE_MAPS_API_KEY');

  if (!apiKey) {
    throw new Error('Missing GEOCODE_MAPS_API_KEY (legacy fallback: GOOGLE_MAPS_API_KEY)');
  }

  return apiKey;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCoordinate(value: string | number | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildQueryCandidates(address: string) {
  const base = String(address || '').trim().replace(/\s+/g, ' ');
  const lower = base.toLowerCase();
  const candidates = [base];

  if (!/\bphilippines\b|\bph\b/.test(lower)) {
    candidates.push(`${base}, Philippines`);
  }

  const mentionsManila = /\bmanila\b|\bmetro manila\b|\bncr\b|\bmaynila\b/.test(lower);
  if (!mentionsManila) {
    candidates.push(`${base}, Manila, Metro Manila, Philippines`);
    candidates.push(`${base}, Metro Manila, Philippines`);
  }

  return Array.from(new Set(candidates));
}

export async function forwardGeocodeAddress(address: string): Promise<ForwardGeocodeResult | null> {
  const normalizedAddress = String(address || '').trim();
  if (!normalizedAddress) return null;

  const apiKey = getApiKey();
  const queryCandidates = buildQueryCandidates(normalizedAddress);

  for (const query of queryCandidates) {
    const params = new URLSearchParams({
      q: query,
      countrycodes: 'ph',
      limit: '1',
      addressdetails: '1',
      format: 'jsonv2',
      api_key: apiKey,
    });

    const url = `https://geocode.maps.co/search?${params.toString()}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.status === 429 || res.status === 503) {
        if (attempt < 2) {
          await sleep((attempt + 1) * 1000);
          continue;
        }

        throw new Error('Geocoding service is rate-limited or temporarily unavailable');
      }

      if (res.status === 403) {
        throw new Error('Geocoding API rejected the request. Check GEOCODE_MAPS_API_KEY and plan limits.');
      }

      if (!res.ok) {
        break;
      }

      const json = (await res.json()) as GeocodeMapsSearchItem[] | null;
      const first = Array.isArray(json) ? json[0] : null;
      if (!first) break;

      const lat = parseCoordinate(first.lat);
      const lng = parseCoordinate(first.lon);
      if (lat === null || lng === null) break;

      return {
        lat,
        lng,
        formatted_address: String(first.display_name || '').trim(),
        address: first.address && typeof first.address === 'object' ? first.address : {},
      };
    }
  }

  return null;
}
