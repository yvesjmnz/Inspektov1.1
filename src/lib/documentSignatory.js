import { supabase } from './supabase';

export async function getActiveDocumentSignatory(expiresInSeconds = 60) {
  try {
    const { data, error } = await supabase.rpc('get_active_document_signature');
    if (error) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.signature_path) return null;

    let signatureUrl = row.signature_path;
    if (!/^https?:\/\//i.test(signatureUrl) && !/^data:/i.test(signatureUrl)) {
      const { data: signed } = await supabase.storage
        .from(row.signature_bucket)
        .createSignedUrl(row.signature_path, expiresInSeconds);
      signatureUrl = signed?.signedUrl || '';

      if (!signatureUrl) {
        const { data: publicData } = supabase.storage
          .from(row.signature_bucket)
          .getPublicUrl(row.signature_path);
        signatureUrl = publicData?.publicUrl || '';
      }
    }

    if (!signatureUrl) return null;
    return {
      id: row.id,
      name: row.signatory_name || 'LEVI C. FACUNDO',
      title: row.signatory_title || 'Director',
      signatureUrl,
      assignmentType: row.assignment_type,
      activeUntil: row.active_until,
    };
  } catch {
    return null;
  }
}
