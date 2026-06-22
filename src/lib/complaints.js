import { supabase } from './supabase';
import { isMissingMissionOrderComplaintsTable } from './complaintGrouping';

const MANILA_CITY_BOUNDS = {
  minLat: 14.54,
  maxLat: 14.71,
  minLng: 120.95,
  maxLng: 121.03,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeComplaintLookup(complaintId) {
  const lookup = String(complaintId || '').trim().toUpperCase();
  if (!lookup) return '';

  if (/^\d{1,6}$/.test(lookup)) {
    return `CMP-${lookup.padStart(6, '0')}`;
  }

  return lookup;
}

function isInsideManilaBounds(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= MANILA_CITY_BOUNDS.minLat &&
    lat <= MANILA_CITY_BOUNDS.maxLat &&
    lng >= MANILA_CITY_BOUNDS.minLng &&
    lng <= MANILA_CITY_BOUNDS.maxLng
  );
}

export async function getBusinesses(searchQuery = '') {
  let query = supabase.from('businesses').select('*');

  if (searchQuery) {
    query = query.or(
      `business_name.ilike.%${searchQuery}%,marketed_name.ilike.%${searchQuery}%,business_address.ilike.%${searchQuery}%`
    );
  }

  const { data, error } = await query.limit(50);

  if (error) throw new Error(error.message);
  return data;
}

export async function getBusinessById(businessPk) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('business_pk', businessPk)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function submitComplaint(complaintData) {
  const { data, error } = await supabase
    .from('complaints')
    .insert([complaintData])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function checkComplaintCooldown({ business_pk, business_name, business_address } = {}) {
  const { data, error } = await supabase.rpc('get_complaint_cooldown_status', {
    p_business_pk: business_pk || null,
    p_business_name: String(business_name || '').trim(),
    p_business_address: String(business_address || '').trim(),
  });

  if (error) throw new Error(error.message);
  return data || { blocked: false };
}

export async function resolveBusinessJurisdiction(address) {
  const normalizedAddress = String(address || '').trim();

  const { data, error } = await supabase.functions.invoke('verify-business-proximity', {
    body: {
      business_address: normalizedAddress,
      // Sent for backward compatibility with older deployed versions of the edge function
      // that still require reporter coordinates before geocoding.
      reporter_lat: 14.5896,
      reporter_lng: 120.9747,
    },
  });

  if (error) throw new Error(error.message || 'Failed to validate business address.');
  if (!data?.ok) throw new Error(data?.error || 'Failed to validate business address.');

  if (typeof data.within_manila_city !== 'boolean') {
    const lat = data?.business_coords?.lat;
    const lng = data?.business_coords?.lng;

    return {
      ...data,
      resolved_address: String(data?.resolved_address || data?.business_address || normalizedAddress),
      resolved_locality: data?.resolved_locality || null,
      within_manila_city: isInsideManilaBounds(lat, lng),
    };
  }

  return data;
}

export async function getComplaintById(complaintId) {
  const lookup = normalizeComplaintLookup(complaintId);
  const query = supabase
    .from('complaints')
    .select('*');

  const { data, error } = UUID_PATTERN.test(lookup)
    ? await query.eq('id', lookup).single()
    : await query.eq('complaint_code', lookup).single();

  if (error) throw new Error(error.message);
  return data;
}

// Enriched fetch for tracking: complaint + related mission orders + inspection reports
export async function getComplaintTracking(complaintId) {
  // 1) Fetch base complaint
  const complaint = await getComplaintById(complaintId);

  // 2) Fetch mission orders directly or group-linked to complaint
  const { data: directMissionOrders, error: moErr } = await supabase
    .from('mission_orders')
    .select('id, status, submitted_at, updated_at, created_at, director_preapproved_at')
    .eq('complaint_id', complaint.id)
    .order('created_at', { ascending: true });
  if (moErr) throw new Error(moErr.message);

  const { data: linkedRows, error: linkErr } = await supabase
    .from('mission_order_complaints')
    .select('mission_order_id')
    .eq('complaint_id', complaint.id);
  if (linkErr && !isMissingMissionOrderComplaintsTable(linkErr)) throw new Error(linkErr.message);

  const directIds = (directMissionOrders || []).map((m) => m.id).filter(Boolean);
  const linkedIds = linkErr ? [] : (linkedRows || []).map((row) => row.mission_order_id).filter(Boolean);
  const linkedOnlyIds = linkedIds.filter((id) => !directIds.includes(id));

  const { data: linkedMissionOrders, error: linkedMoErr } = linkedOnlyIds.length
    ? await supabase
        .from('mission_orders')
        .select('id, status, submitted_at, updated_at, created_at, director_preapproved_at')
        .in('id', linkedOnlyIds)
        .order('created_at', { ascending: true })
    : { data: [], error: null };
  if (linkedMoErr) throw new Error(linkedMoErr.message);

  const missionOrders = [...(directMissionOrders || []), ...(linkedMissionOrders || [])]
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

  // 3) Fetch inspection reports potentially linked via mission orders
  let inspections = [];
  if (missionOrders && missionOrders.length > 0) {
    const moIds = missionOrders.map((m) => m.id);
    const { data: reports, error: repErr } = await supabase
      .from('inspection_reports')
      .select(
        'id, mission_order_id, status, created_at, started_at, completed_at, updated_at, generated_docx_url, generated_docx_created_at, business_permit_status, cctv_status, signage_status, cctv_count, no_of_employees, inspection_comments'
      )
      .in('mission_order_id', moIds)
      .order('created_at', { ascending: true });
    if (repErr) throw new Error(repErr.message);
    inspections = reports || [];
  }

  return { complaint, missionOrders: missionOrders || [], inspections };
}

export async function uploadImage(file, bucket = 'complaint-images') {
  const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file);

  if (error) throw new Error(error.message);

  const { data: publicUrl } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName);

  return publicUrl.publicUrl;
}

export async function uploadDocument(file, bucket = 'complaint-images') {
  return uploadImage(file, bucket);
}
