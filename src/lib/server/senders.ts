// Delivery for login codes. Without provider credentials (local dev) codes are logged
// to the terminal running `npm run dev` instead of being sent.
import { env } from 'cloudflare:workers';
import type { Senders } from './auth-options';

async function sendEmail(to: string, code: string) {
  const subject = `${code} is your Sink Alike code`;
  const text = `Your Sink Alike sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#17161a">
  <p style="font-family:Georgia,serif;font-size:24px;margin:0 0 16px">Sink <em>Alike</em></p>
  <p>Your sign-in code is</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</p>
  <p style="color:#55535a">It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p></div>`;

  if (!env.RESEND_API_KEY) {
    console.log(`[dev] Email code for ${to}: ${code}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Sink Alike <login@sinkalike.com>', to, subject, text, html }),
  });
  if (!response.ok) {
    console.error('Resend error', response.status, await response.text());
    throw new Error('Could not send the email. Please try again.');
  }
}

async function sendSms(to: string, code: string) {
  const body = `${code} is your Sink Alike code. It expires in 10 minutes.`;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    console.log(`[dev] SMS code for ${to}: ${code}`);
    return;
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
  });
  if (!response.ok) {
    console.error('Twilio error', response.status, await response.text());
    throw new Error('Could not send the text. Check the number and try again.');
  }
}

export const senders: Senders = { email: sendEmail, sms: sendSms };

/** Which sign-in methods to offer. Email and phone always work in dev (codes are logged). */
export function loginMethods() {
  const dev = import.meta.env.DEV;
  return {
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    email: dev || !!env.RESEND_API_KEY,
    phone: dev || !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
  };
}
