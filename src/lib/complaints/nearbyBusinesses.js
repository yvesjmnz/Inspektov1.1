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
  if (userLat == null || userLng == null) {
    throw new Error('User location is required');
  }

  try {
    // Fetch all businesses (we'll filter by distance in JavaScript)
    // This is simpler than using PostGIS if not available
    const { data, error } = await supabase
      .from('businesses')
      .select('business_pk, business_name, business_address, business_lat, business_lng')
      .not('business_lat', 'is', null)
      .not('business_lng', 'is', null);

    if (error) throw error;

    if (!data || data.length === 0) {
      return [];
    }

    // Calculate distance for each business and filter
    const nearby = data
      .map((business) => ({
        ...business,
        distance: calculateDistance(
          userLat,
          userLng,
          business.business_lat,
          business.business_lng
        ),
      }))
      .filter((business) => business.distance <= radiusMeters)
      .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)

    return nearby;
  } catch (error) {
    console.error('Error fetching nearby businesses:', error);
    throw error;
  }
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
