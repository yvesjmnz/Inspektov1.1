/**
 * Batch Geocoding Utility
 * 
 * Runs batch geocoding job to populate missing business coordinates
 */

import { supabase } from '../supabase';

/**
 * Run batch geocoding for businesses with missing coordinates
 * @param {Object} options - Configuration options
 * @param {number} [options.limit=50] - Number of businesses to process
 * @param {number} [options.offset=0] - Starting offset
 * @param {boolean} [options.dryRun=false] - Preview only, no updates
 * @returns {Promise<Object>} Result of batch geocoding job
 */
export async function runBatchGeocoding(options) {
  try {
    const { data, error } = await supabase.functions.invoke('batch-geocode-businesses', {
      body: {
        limit: options?.limit || 50,
        offset: options?.offset || 0,
        dryRun: options?.dryRun || false,
      },
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Batch geocoding error:', error);
    throw error;
  }
}

/**
 * Run batch geocoding for all businesses (paginated)
 * @param {Function} [onProgress] - Callback for progress updates
 * @returns {Promise<Object>} Final result
 */
export async function runFullBatchGeocoding(onProgress) {
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const allErrors = [];
  const allDetails = [];

  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    try {
      const result = await runBatchGeocoding({ limit, offset, dryRun: false });

      totalProcessed += result.processed;
      totalUpdated += result.updated;
      totalFailed += result.failed;
      allErrors.push(...result.errors);
      if (result.details) {
        allDetails.push(...result.details);
      }

      if (onProgress) {
        onProgress({
          processed: totalProcessed,
          updated: totalUpdated,
          failed: totalFailed,
          errors: allErrors,
          details: allDetails,
        });
      }

      // If fewer than limit were processed, we've reached the end
      if (result.processed < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    } catch (error) {
      console.error('Error in batch geocoding loop:', error);
      allErrors.push(error instanceof Error ? error.message : 'Unknown error');
      hasMore = false;
    }
  }

  return {
    processed: totalProcessed,
    updated: totalUpdated,
    failed: totalFailed,
    errors: allErrors,
    details: allDetails,
  };
}

/**
 * Get count of businesses with missing coordinates
 * @returns Number of businesses needing geocoding
 */
export async function getBusinessesNeedingGeocoding() {
  try {
    const { count, error } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true })
      .or('business_lat.is.null,business_lng.is.null');

    if (error) throw error;

    return count || 0;
  } catch (error) {
    console.error('Error getting count:', error);
    return 0;
  }
}
