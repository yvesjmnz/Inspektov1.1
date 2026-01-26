import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendMail } from "../_shared/smtp.ts";

type RequestBody = {
  email: string;
  complaintId: string;
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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const email = (body.email || "").trim().toLowerCase();
  const complaintId = (body.complaintId || "").trim();

  if (!isValidEmail(email)) return json(400, { error: "Invalid email" });
  if (!complaintId) return json(400, { error: "Missing complaint ID" });

  const smtpUser = Deno.env.get("GMAIL_SMTP_USERNAME");
  const smtpPass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
  const smtpFrom = Deno.env.get("GMAIL_SMTP_FROM") || smtpUser;
  if (!smtpUser || !smtpPass || !smtpFrom) return json(500, { error: "Missing SMTP env" });

  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!appBaseUrl) return json(500, { error: "Missing APP_BASE_URL" });

  const supportEmail = Deno.env.get("SUPPORT_EMAIL") || "support@inspekto.local";
  const trackingUrl = `${appBaseUrl.replace(/\/$/, "")}/tracking?id=${encodeURIComponent(complaintId)}`;

  const subject = "Inspekto: Your complaint has been submitted";

  const brandName = "Inspekto";

  const html = `
  <div style="margin:0;padding:0;background:#f5f7fb;">
    <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
      <div style="background:#0b5bd3;background:linear-gradient(90deg,#2563eb,#1d4ed8,#1e40af);border-radius:14px 14px 0 0;padding:20px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.2px;">${brandName}</div>
          <div style="margin-top:2px;font-size:13px;opacity:0.9;">Complaint Submission Confirmation</div>
        </div>
      </div>

      <div style="background:#ffffff;border:1px solid #e7eefc;border-top:none;border-radius:0 0 14px 14px;padding:26px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
          <h1 style="margin:0 0 10px 0;font-size:20px;font-weight:700;">Thank you for your report</h1>

          <p style="margin:0 0 18px 0;font-size:14px;color:#334155;">
            Your complaint has been successfully submitted. We appreciate you helping us maintain transparency and accountability.
          </p>

          <div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:14px 16px;margin:18px 0;border-radius:4px;">
            <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your Complaint ID</div>
            <div style="font-size:18px;font-weight:700;color:#0f172a;font-family:'Courier New',monospace;letter-spacing:1px;">${complaintId}</div>
          </div>

          <p style="margin:0 0 14px 0;font-size:14px;color:#334155;">
            Use this ID to track the status of your complaint at any time.
          </p>

          <div style="margin:18px 0 18px 0;">
            <a href="${trackingUrl}"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 16px;border-radius:10px;">
              Track your complaint
            </a>
          </div>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />

          <p style="margin:0 0 8px 0;font-size:13px;color:#475569;font-weight:600;">What happens next?</p>
          <ul style="margin:8px 0 14px 0;padding-left:20px;font-size:13px;color:#475569;">
            <li style="margin-bottom:6px;">Your complaint will be reviewed by our team</li>
            <li style="margin-bottom:6px;">We will verify the information you provided</li>
            <li>You can track progress using your complaint ID</li>
          </ul>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />

          <p style="margin:0;font-size:12px;color:#64748b;">
            Need help? Contact <a href="mailto:${supportEmail}" style="color:#2563eb;text-decoration:none;">${supportEmail}</a>
          </p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">
            This is an automated message. Please do not reply.
          </p>
        </div>
      </div>

      <div style="font-family:Arial,Helvetica,sans-serif;text-align:center;color:#94a3b8;font-size:11px;margin-top:12px;">
        <div>${brandName}</div>
        <div style="margin-top:4px;">Transparency through accountability</div>
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
    console.error("Failed to send email:", e);
    return json(500, { error: "Failed to send confirmation email" });
  }

  return json(200, { success: true });
});
