// Thin fetch wrappers around Better Auth's REST endpoints (keeps the client bundle tiny).

export async function auth<T = unknown>(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message: string = data?.message ?? data?.error?.message ?? '';
    throw new Error(friendly(message, response.status));
  }
  return data as T;
}

function friendly(message: string, status: number): string {
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (/captcha/i.test(message)) return 'The spam check didn’t pass. Please try again.';
  if (/invalid otp|invalid code|otp.*(invalid|expired)/i.test(message)) return 'That code is wrong or has expired.';
  if (/too many attempts/i.test(message)) return 'Too many wrong codes. Request a new one.';
  if (/phone/i.test(message) && /invalid/i.test(message)) return 'Enter your number with the country code, e.g. +44 7700 900123.';
  return message || 'Something went wrong. Please try again.';
}

/** Only allow same-site relative redirects after login. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/account/';
  return raw;
}
