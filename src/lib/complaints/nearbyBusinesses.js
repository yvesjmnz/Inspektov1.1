/**
 * Nearby Businesses Finder
 * 
 * Finds businesses near user's current location using geolocation + database query
 */

import { supabase } from '../supabase';

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - User business_lat
 * @param {number} lng1 - User business_lng
 * @param {number} lat2 - Business business_lat
 * @param {number} lng2 - Business business_lng
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get nearby businesses from database
 * @param {number} userLat - User business_lat
 * @param {number} userLng - User business_lng
 * @param {number} radiusMeters - Search radius in meters (default: 500m)
 * @returns {Promise<Array>} Array of nearby businesses sorted by distance
 */
export async function getNearbyBusinesses(userLat, userLng, radiusMeters = 200) {
  const latDelta = radiusMeters / 111320;
  const lngDelta =
    radiusMeters / (111320 * Math.cos((userLat * Math.PI) / 180));

  const { data, error } = await supabase
    .from('businesses')
    .select('business_pk, business_name, business_address, business_lat, business_lng')
    .gte('business_lat', userLat - latDelta)
    .lte('business_lat', userLat + latDelta)
    .gte('business_lng', userLng - lngDelta)
    .lte('business_lng', userLng + lngDelta);

  if (error) throw error;

  const nearby = data
    .map((b) => ({
      ...b,
      distance: calculateDistance(
        userLat,
        userLng,
        b.business_lat,
        b.business_lng
      ),
    }))
    .filter((b) => b.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);

  return nearby;
}

/**
 * Format distance for display
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted distance (e.g., "150m", "1.2km")
 */
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
