import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { generateToken, hashToken, nowPlusMinutes } from "../_shared/token.ts";
import { sendMail } from "../_shared/smtp.ts";

type RequestBody = {
  email: string;
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

function isValidEmail(email: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase env" });

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { error: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return json(401, { error: "Missing access token" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user?.id) return json(401, { error: "Unauthorized" });

  const metadataRole = String(
    authData.user.app_metadata?.role || authData.user.user_metadata?.role || "",
  ).toLowerCase().trim();

  let isDirector = metadataRole === "director";

  if (!isDirector) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) return json(500, { error: "Failed to validate user role" });
    isDirector = String(profile?.role || "").toLowerCase() === "director";
  }

  if (!isDirector) {
    return json(403, { error: "Only directors can send the special complaint form link" });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return json(400, { error: "Invalid email" });

  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!appBaseUrl) return json(500, { error: "Missing APP_BASE_URL" });

  const smtpUser = Deno.env.get("GMAIL_SMTP_USERNAME");
  const smtpPass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
  const smtpFrom = Deno.env.get("GMAIL_SMTP_FROM") || smtpUser;
  if (!smtpUser || !smtpPass || !smtpFrom) return json(500, { error: "Missing SMTP env" });

  const tokenTtlMinutes = Number(Deno.env.get("EMAIL_TOKEN_TTL_MINUTES") || "30");
  const token = generateToken(32);
  const tokenHash = await hashToken(token);
  const expiresAt = nowPlusMinutes(tokenTtlMinutes);

  const { error: insertErr } = await supabase
    .from("email_verification_tokens")
    .insert({
      email,
      complaint_id: null,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      form_type: "special-complaint",
    });

  if (insertErr) {
    console.error("Failed to create special complaint token:", insertErr);
    return json(500, { error: "Failed to create secure form link" });
  }

  const supportEmail = Deno.env.get("SUPPORT_EMAIL") || "support@inspekto.local";
  const specialFormUrl = `${appBaseUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}&form=special-complaint`;

  const subject = "Inspekto: Special Complaint Form Link";
  const brandName = "Inspekto";

  const html = `
  <div style="margin:0;padding:0;background:#f5f7fb;">
    <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
      <div style="background:#0b5bd3;background:linear-gradient(90deg,#2563eb,#1d4ed8,#1e40af);border-radius:14px 14px 0 0;padding:20px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.2px;">${brandName}</div>
          <div style="margin-top:2px;font-size:13px;opacity:0.9;">Special Complaint Form Invitation</div>
        </div>
      </div>

      <div style="background:#ffffff;border:1px solid #e7eefc;border-top:none;border-radius:0 0 14px 14px;padding:26px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
          <h1 style="margin:0 0 10px 0;font-size:20px;font-weight:700;">You are invited to submit a special complaint</h1>

          <p style="margin:0 0 14px 0;font-size:14px;color:#334155;">
            This form is intended for special government agencies or authorized complainants.
          </p>

          <p style="margin:0 0 14px 0;font-size:13px;color:#475569;">
            This secure access link expires in <strong>${tokenTtlMinutes} minutes</strong> and is meant only for the recipient of this email.
          </p>

          <div style="margin:18px 0 18px 0;">
            <a href="${specialFormUrl}"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 16px;border-radius:10px;">
              Open special complaint form
            </a>
          </div>

          <p style="margin:0 0 6px 0;font-size:13px;color:#475569;">
            If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 14px 0;font-size:12px;color:#2563eb;word-break:break-all;">
            ${specialFormUrl}
          </p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />

          <p style="margin:0;font-size:12px;color:#64748b;">
            Need help? Contact <a href="mailto:${supportEmail}" style="color:#2563eb;text-decoration:none;">${supportEmail}</a>
          </p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">
            This is an automated message. Please do not reply.
          </p>
        </div>
      </div>
    </div>
  </div>
  `;

  try {
    await sendMail(
      {
        hostname: "smtp.gmail.com",
        port: 465,
        username: smtpUser,
        password: smtpPass,
        from: smtpFrom,
      },
      email,
      subject,
      html,
    );
  } catch (e) {
    console.error("Failed to send special complaint form email:", e);
    return json(500, { error: "Failed to send special complaint form link" });
  }

  return json(200, {
    success: true,
    email,
  });
});
