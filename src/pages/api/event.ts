import type { APIRoute } from 'astro';
import { readJson, sameOrigin } from '../../lib/server/community';
import { CLIENT_EVENTS, record, type EventFields } from '../../lib/server/analytics';

export const prerender = false;

/** Receives navigator.sendBeacon() pings from src/lib/analytics.ts. Always answers 204. */
export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return new Response(null, { status: 403 });
  const input = await readJson<EventFields & { event?: string }>(context.request);
  const event = CLIENT_EVENTS.find((name) => name === input?.event);
  if (input && event) record(event, input, context.request);
  return new Response(null, { status: 204 });
};
