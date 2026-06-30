import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { hashToken } from "../_shared/token.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const body = await req.json().catch(() => null);
  const accessToken = String(body?.accessToken || "").trim();
  const complaint = body?.complaint;
  if (!accessToken || !complaint || typeof complaint !== "object") {
    return json(400, { error: "Complaint access and complaint details are required" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase env" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await hashToken(accessToken);
  const { data: access, error: accessError } = await supabase
    .from("complaint_access_tokens")
    .select("id,email,form_type,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (accessError) return json(500, { error: "Unable to validate complaint access" });
  if (!access || access.used_at) return json(401, { error: "Complaint access is invalid or has already been used" });
  if (new Date(access.expires_at).getTime() <= Date.now()) {
    return json(401, { error: "Complaint access has expired" });
  }

  const verifiedEmail = String(access.email || "").trim().toLowerCase();
  const submittedEmail = String(complaint.reporter_email || "").trim().toLowerCase();
  if (!submittedEmail || submittedEmail !== verifiedEmail) {
    return json(403, { error: "Reporter email does not match the verified email" });
  }
  const isSpecial = Array.isArray(complaint.tags) && complaint.tags.some(
    (tag: unknown) => String(tag || "").trim().toLowerCase() === "special complaint",
  );
  if ((access.form_type === "special-complaint") !== isSpecial) {
    return json(403, { error: "This access token is not valid for the requested complaint form" });
  }

  const { data: ban } = await supabase
    .from("reporter_bans")
    .select("id")
    .eq("email", verifiedEmail)
    .eq("active", true)
    .maybeSingle();
  if (ban) return json(403, { error: "This email address is not permitted to submit complaints." });

  // Whitelist public intake fields. Never pass arbitrary client keys through a
  // service-role insert (for example status, approval, or audit columns).
  const payload = {
    business_pk: complaint.business_pk || null,
    business_name: String(complaint.business_name || "").trim(),
    business_address: String(complaint.business_address || "").trim(),
    complaint_description: String(complaint.complaint_description || "").trim(),
    reporter_email: verifiedEmail,
    image_urls: Array.isArray(complaint.image_urls) ? complaint.image_urls : [],
    document_urls: Array.isArray(complaint.document_urls) ? complaint.document_urls : [],
    tags: Array.isArray(complaint.tags) ? complaint.tags : [],
    reporter_lat: complaint.reporter_lat ?? null,
    reporter_lng: complaint.reporter_lng ?? null,
    reporter_accuracy: complaint.reporter_accuracy ?? null,
    reporter_location_timestamp: complaint.reporter_location_timestamp ?? null,
    certification_accepted: complaint.certification_accepted === true,
    certification_accepted_at: complaint.certification_accepted === true ? new Date().toISOString() : null,
    status: "Submitted",
    email_verified: true,
    email_verified_at: new Date().toISOString(),
  };
  if (!payload.business_name || !payload.business_address || !payload.complaint_description) {
    return json(400, { error: "Business and complaint details are required" });
  }

  // Claim the token before inserting so concurrent/replayed requests cannot
  // create more than one complaint.
  const { data: claimed, error: claimError } = await supabase
    .from("complaint_access_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", access.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) {
    return json(401, { error: "Complaint access has already been used" });
  }

  const { data: created, error: insertError } = await supabase
    .from("complaints")
    .insert(payload)
    .select("*")
    .single();
  if (insertError) {
    await supabase
      .from("complaint_access_tokens")
      .update({ used_at: null })
      .eq("id", access.id);
    return json(400, { error: insertError.message || "Failed to submit complaint" });
  }

  return json(200, { success: true, complaint: created });
});
