import { supabase } from './supabase';

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

export async function getComplaintById(complaintId) {
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('id', complaintId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function uploadImage(file, bucket = 'storage-images') {
  const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`;
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file);

  if (error) throw new Error(error.message);

  const { data: publicUrl } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName);

  return publicUrl.publicUrl;
}

export async function uploadDocument(file, bucket = 'storage-images') {
  return uploadImage(file, bucket);
}
