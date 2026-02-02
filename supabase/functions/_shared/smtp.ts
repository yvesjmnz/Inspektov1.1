// Gmail SMTP sender for Supabase Edge Functions (Deno)
//
// Uses Deno standard library SMTP client.
// Note: In Supabase Edge Functions, outbound SMTP may be blocked depending on platform/network policies.
// If you run into connectivity issues, the fallback is using an HTTPS email API provider.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export type SmtpConfig = {
  hostname: string;
  port: number;
  username: string;
  password: string;
  from: string;
};

export async function sendMail(
  config: SmtpConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: config.hostname,
      port: config.port,
      tls: true,
      auth: {
        username: config.username,
        password: config.password,
      },
    },
  });

  try {
    await client.send({
      from: config.from,
      to,
      subject,
      content: html,
      html,
    });
  } finally {
    await client.close();
  }
}
