// supabase/functions/batch-geocode-businesses/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { forwardGeocodeAddress } from '../_shared/geocodeMaps.ts'

type BatchRequest = {
  limit?: number
  offset?: number
  dryRun?: boolean
}

type Business = {
  business_pk: number
  business_name: string
  business_address: string
}

type UpdateRow = {
  business_pk: number
  business_lat: number
  business_lng: number
}

type BatchResponse = {
  processed: number
  updated: number
  failed: number
  errors: string[]
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const result = await forwardGeocodeAddress(address)
  if (!result) return null

  return { lat: result.lat, lng: result.lng }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }

    const body = (await req.json()) as Partial<BatchRequest>

    const limit = body.limit ?? 500
    const offset = body.offset ?? 0
    const dryRun = body.dryRun ?? false

    const supabase = getSupabaseClient()

    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('business_pk, business_name, business_address')
      .or('business_lat.is.null,business_lng.is.null')
      .range(offset, offset + limit - 1)

    if (error) throw error

    if (!businesses || businesses.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          updated: 0,
          failed: 0,
          errors: [],
        }),
        {
          headers: { 'Access-Control-Allow-Origin': '*' },
        }
      )
    }

    const cache = new Map<string, { lat: number; lng: number } | null>()

    let failed = 0
    const updates: UpdateRow[] = []
    const errors: string[] = []

    async function processBusiness(business: Business) {
      const address = business.business_address?.trim()

      if (!address || address.length < 5) {
        failed++
        return
      }

      try {
        let coords = cache.get(address)

        if (coords === undefined) {
          coords = await geocodeAddress(address)
          cache.set(address, coords)

          // geocode.maps.co can throttle aggressively on lower plans, so pace uncached requests.
          await sleep(1100)
        }

        if (!coords) {
          failed++
          errors.push(`Geocode failed: ${business.business_name}`)
          return
        }

        updates.push({
          business_pk: business.business_pk,
          business_lat: coords.lat,
          business_lng: coords.lng,
        })
      } catch (e) {
        failed++
        errors.push(`Error processing ${business.business_name}`)
      }
    }

    for (const business of businesses) {
      await processBusiness(business)
    }

    let updated = 0

    if (!dryRun && updates.length > 0) {
      const { error: updateError } = await supabase
        .from('businesses')
        .upsert(updates, { onConflict: 'business_pk' })

      if (updateError) throw updateError

      updated = updates.length
    }

    const response: BatchResponse = {
      processed: businesses.length,
      updated,
      failed,
      errors,
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({
        processed: 0,
        updated: 0,
        failed: 0,
        errors: [e instanceof Error ? e.message : 'Unknown error'],
      }),
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
