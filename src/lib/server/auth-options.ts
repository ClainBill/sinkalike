// Better Auth configuration shared by the Worker (src/lib/server/auth.ts) and the schema
// generator (scripts/auth-schema.ts). Keep this free of Cloudflare-only imports.
import type { BetterAuthOptions } from 'better-auth';
import { emailOTP, phoneNumber, captcha } from 'better-auth/plugins';

export type AuthEnv = {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
};

export type Senders = {
  email: (to: string, code: string) => Promise<void>;
  sms: (to: string, code: string) => Promise<void>;
};

export function authOptions(env: AuthEnv, database: BetterAuthOptions['database'], send: Senders) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' as const } }
      : {};

  return {
    appName: 'Sink Alike',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    database,
    socialProviders: google,
    account: { accountLinking: { enabled: true, trustedProviders: ['google', 'email-otp'] } },
    user: { deleteUser: { enabled: true } },
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 days
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/email-otp/send-verification-otp': { window: 300, max: 3 },
        '/phone-number/send-otp': { window: 300, max: 3 },
        '/sign-in/email-otp': { window: 300, max: 10 },
        '/phone-number/verify': { window: 300, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }) {
          await send.email(email, otp);
        },
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        // E.164 only, e.g. +447700900123
        phoneNumberValidator: (value) => /^\+[1-9]\d{7,14}$/.test(value),
        sendOTP: async ({ phoneNumber, code }) => send.sms(phoneNumber, code),
        signUpOnVerification: {
          // Phone-only accounts still need a unique email internally; it's never shown or emailed.
          getTempEmail: (value) => `${value.replace(/\D/g, '')}@phone.sinkalike.invalid`,
          getTempName: () => '',
        },
      }),
      // Code-sending endpoints cost money (SMS) and reputation (email), so they need a Turnstile token.
      ...(env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: 'cloudflare-turnstile',
              secretKey: env.TURNSTILE_SECRET_KEY,
              endpoints: ['/email-otp/send-verification-otp', '/phone-number/send-otp'],
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;
}
