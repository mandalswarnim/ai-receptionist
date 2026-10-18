/**
 * Calendly API v2 client: open slots for an event type, and booking a caller
 * into one (the Scheduling API, which needs a paid Calendly plan).
 *
 * Auth is a personal access token (CALENDLY_API_TOKEN) from the account that
 * owns the event types. Every request is short-timed: these run while a
 * caller is waiting on the line.
 */

import { config } from '../config';

const API = 'https://api.calendly.com';
const REQUEST_TIMEOUT_MS = 5_000;
/** Calendly's limit on one available-times query. */
export const MAX_RANGE_DAYS = 7;

export const EVENT_TYPE_URI = /^https:\/\/api\.calendly\.com\/event_types\/[\w-]+$/;

export class CalendlyError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CalendlyError';
  }
}

export function calendlyConfigured(): boolean {
  return !!config.CALENDLY_API_TOKEN;
}

async function request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!config.CALENDLY_API_TOKEN) throw new CalendlyError('CALENDLY_API_TOKEN is not set');
  let res: Response;
  try {
    res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${config.CALENDLY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CalendlyError(`Calendly request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    // Error bodies are { title, message, details? }; never echo the token
    const body = (await res.json().catch(() => ({}))) as { title?: string; message?: string };
    throw new CalendlyError(body.message || body.title || `Calendly returned ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

// ─── Event types ─────────────────────────────────────────────────────────────

export interface EventTypeLocation {
  kind: string;
  location?: string;
}

export interface EventTypeInfo {
  uri: string;
  name: string;
  durationMinutes: number;
  schedulingUrl: string;
  locations: EventTypeLocation[];
  active: boolean;
}

interface RawEventType {
  uri: string;
  name: string;
  duration: number;
  scheduling_url: string;
  locations?: EventTypeLocation[] | null;
  active: boolean;
}

function toEventType(raw: RawEventType): EventTypeInfo {
  return {
    uri: raw.uri,
    name: raw.name,
    durationMinutes: raw.duration,
    schedulingUrl: raw.scheduling_url,
    locations: raw.locations ?? [],
    active: raw.active,
  };
}

// Event types rarely change; cache them so a call doesn't re-fetch per turn.
const EVENT_TYPE_TTL_MS = 10 * 60_000;
const eventTypeCache = new Map<string, { info: EventTypeInfo; expiresAt: number }>();

export async function getEventType(uri: string): Promise<EventTypeInfo> {
  const cached = eventTypeCache.get(uri);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  const { resource } = await request<{ resource: RawEventType }>(uri);
  const info = toEventType(resource);
  eventTypeCache.set(uri, { info, expiresAt: Date.now() + EVENT_TYPE_TTL_MS });
  return info;
}

/** The token owner's event types, for picking one to set on a business. */
export async function listEventTypes(): Promise<EventTypeInfo[]> {
  const { resource: me } = await request<{ resource: { uri: string } }>('/users/me');
  const { collection } = await request<{ collection: RawEventType[] }>(
    `/event_types?user=${encodeURIComponent(me.uri)}&count=100`
  );
  return collection.map(toEventType);
}

// ─── Availability ────────────────────────────────────────────────────────────

/** Open start times (ISO, UTC) between `from` and `to`, at most MAX_RANGE_DAYS apart. */
export async function getAvailableTimes(eventTypeUri: string, from: Date, to: Date): Promise<string[]> {
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: from.toISOString(),
    end_time: to.toISOString(),
  });
  const { collection } = await request<{ collection: Array<{ status: string; start_time: string }> }>(
    `/event_type_available_times?${params}`
  );
  return collection
    .filter((slot) => slot.status === 'available')
    .map((slot) => new Date(slot.start_time).toISOString());
}

// ─── Booking ─────────────────────────────────────────────────────────────────

export interface BookingRequest {
  eventTypeUri: string;
  /** ISO start time, exactly as returned by getAvailableTimes. */
  startTime: string;
  name: string;
  email: string;
  timezone: string;
  location?: EventTypeLocation;
}

export interface Booking {
  eventUri: string;
  cancelUrl: string | null;
  rescheduleUrl: string | null;
}

export async function createBooking(req: BookingRequest): Promise<Booking> {
  const { resource } = await request<{
    resource: { event: string; cancel_url?: string; reschedule_url?: string };
  }>('/invitees', {
    method: 'POST',
    body: {
      event_type: req.eventTypeUri,
      start_time: req.startTime,
      invitee: { name: req.name, email: req.email, timezone: req.timezone },
      ...(req.location ? { location: req.location } : {}),
      tracking: { utm_source: 'ai-receptionist' },
    },
  });
  return {
    eventUri: resource.event,
    cancelUrl: resource.cancel_url ?? null,
    rescheduleUrl: resource.reschedule_url ?? null,
  };
}

/** Test hook: forget cached event types. */
export function clearEventTypeCache(): void {
  eventTypeCache.clear();
}
