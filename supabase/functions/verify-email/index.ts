import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { hashToken } from "../_shared/token.ts";

type RequestBody = {
  token: string;
};

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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const token = (body.token || "").trim();
  if (!token) return json(400, { error: "Missing token" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase env" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const tokenHash = await hashToken(token);

  // Find token row
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("email_verification_tokens")
    .select("id,email,complaint_id,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenErr) return json(500, { error: "Token lookup failed" });
  if (!tokenRow) return json(400, { error: "Invalid token" });

  if (tokenRow.used_at) return json(400, { error: "Token already used" });

  const expiresAt = new Date(tokenRow.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return json(400, { error: "Token expired" });
  }

  // Mark token used
  const { error: useErr } = await supabase
    .from("email_verification_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenRow.id)
    .is("used_at", null);

  if (useErr) return json(500, { error: "Failed to consume token" });

  // If complaint_id exists, mark complaint as verified
  if (tokenRow.complaint_id) {
    const { error: updErr } = await supabase
      .from("complaints")
      .update({ email_verified: true, email_verified_at: new Date().toISOString() })
      .eq("id", tokenRow.complaint_id);

    if (updErr) return json(500, { error: "Failed to update complaint" });
  }

  return json(200, { success: true, email: tokenRow.email, complaintId: tokenRow.complaint_id ?? null });
});
