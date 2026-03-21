import { supabase } from './supabase';

const MANILA_CITY_BOUNDS = {
  minLat: 14.54,
  maxLat: 14.71,
  minLng: 120.95,
  maxLng: 121.03,
};

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
      `business_name.ilike.%${searchQuery}%,business_address.ilike.%${searchQuery}%`
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
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('id', complaintId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// Enriched fetch for tracking: complaint + related mission orders + inspection reports
export async function getComplaintTracking(complaintId) {
  // 1) Fetch base complaint
  const complaint = await getComplaintById(complaintId);

  // 2) Fetch mission orders linked to complaint
  const { data: missionOrders, error: moErr } = await supabase
    .from('mission_orders')
    .select('id, status, submitted_at, updated_at, created_at, director_preapproved_at')
    .eq('complaint_id', complaintId)
    .order('created_at', { ascending: true });
  if (moErr) throw new Error(moErr.message);

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
