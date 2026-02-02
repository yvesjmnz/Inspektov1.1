import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { generateToken, hashToken, nowPlusMinutes } from "../_shared/token.ts";
import { sendMail } from "../_shared/smtp.ts";

type RequestBody = {
  email: string;
  complaintId?: string;
  turnstileToken?: string;
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

// Verify Cloudflare Turnstile token
async function verifyTurnstileToken(token: string): Promise<boolean> {
  try {
    const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secretKey) {
      console.error("Missing TURNSTILE_SECRET_KEY environment variable");
      return false;
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    if (!response.ok) {
      console.error("Turnstile verification request failed:", response.status);
      return false;
    }

    const data = await response.json();
    
    // Turnstile returns { success: boolean, challenge_ts: string, hostname: string, error_codes?: string[] }
    if (!data.success) {
      console.error("Turnstile verification failed:", data.error_codes);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return false;
  }
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

  const email = (body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return json(400, { error: "Invalid email" });

  // Verify Turnstile token if provided
  if (body.turnstileToken) {
    const isValidCaptcha = await verifyTurnstileToken(body.turnstileToken);
    if (!isValidCaptcha) {
      return json(400, { error: "CAPTCHA verification failed. Please try again." });
    }
  } else {
    return json(400, { error: "CAPTCHA verification required" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase env" });

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

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Store token hash
  const { error: insertErr } = await supabase
    .from("email_verification_tokens")
    .insert({
      email,
      complaint_id: body.complaintId ?? null,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

  if (insertErr) {
    return json(500, { error: "Failed to create token" });
  }

  const verifyUrl = `${appBaseUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;

  const subject = "Inspekto: Verify your email to submit a complaint";

  const brandName = "Inspekto";
  const supportEmail = Deno.env.get("SUPPORT_EMAIL") || "support@inspekto.local";

  const html = `
  <div style="margin:0;padding:0;background:#f5f7fb;">
    <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
      <div style="background:#0b5bd3;background:linear-gradient(90deg,#2563eb,#1d4ed8,#1e40af);border-radius:14px 14px 0 0;padding:20px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.2px;">${brandName}</div>
          <div style="margin-top:2px;font-size:13px;opacity:0.9;">Complaint Submission Verification</div>
        </div>
      </div>

      <div style="background:#ffffff;border:1px solid #e7eefc;border-top:none;border-radius:0 0 14px 14px;padding:26px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
          <h1 style="margin:0 0 10px 0;font-size:20px;font-weight:700;">Verify your email address</h1>

          <p style="margin:0 0 14px 0;font-size:14px;color:#334155;">
            We received a request to submit a complaint using this email address. To proceed, please confirm that you own this email.
          </p>

          <div style="margin:18px 0 18px 0;">
            <a href="${verifyUrl}"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 16px;border-radius:10px;">
              Verify email and continue
            </a>
          </div>

          <p style="margin:0 0 12px 0;font-size:13px;color:#475569;">
            This verification link expires in <strong>${tokenTtlMinutes} minutes</strong> and can only be used once.
          </p>

          <p style="margin:0 0 6px 0;font-size:13px;color:#475569;">
            If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 14px 0;font-size:12px;color:#2563eb;word-break:break-all;">
            ${verifyUrl}
          </p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />

          <p style="margin:0;font-size:12px;color:#64748b;">
            If you did not request this verification, you can safely ignore this email.
          </p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">
            Need help? Contact <a href="mailto:${supportEmail}" style="color:#2563eb;text-decoration:none;">${supportEmail}</a>
          </p>
        </div>
      </div>

      <div style="font-family:Arial,Helvetica,sans-serif;text-align:center;color:#94a3b8;font-size:11px;margin-top:12px;">
        <div>${brandName}</div>
        <div style="margin-top:4px;">This is an automated message. Please do not reply.</div>
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
  } catch (_e) {
    // Token is already stored; client can retry sending.
    return json(500, { error: "Failed to send email" });
  }

  return json(200, { success: true });
});
