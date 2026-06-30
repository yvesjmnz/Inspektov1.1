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

  const { accessToken } = await req.json().catch(() => ({ accessToken: "" }));
  const token = String(accessToken || "").trim();
  if (!token) return json(401, { error: "Complaint access token is required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase env" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await hashToken(token);
  const { data: access, error } = await supabase
    .from("complaint_access_tokens")
    .select("id,email,form_type,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) return json(500, { error: "Unable to validate complaint access" });
  if (!access || access.used_at) return json(401, { error: "Complaint access is invalid or has already been used" });
  if (new Date(access.expires_at).getTime() <= Date.now()) {
    return json(401, { error: "Complaint access has expired" });
  }

  const { data: ban } = await supabase
    .from("reporter_bans")
    .select("id")
    .eq("email", String(access.email || "").trim().toLowerCase())
    .eq("active", true)
    .maybeSingle();
  if (ban) return json(403, { error: "This email address is not permitted to submit complaints." });

  return json(200, {
    valid: true,
    email: access.email,
    formType: access.form_type,
    expiresAt: access.expires_at,
  });
});
