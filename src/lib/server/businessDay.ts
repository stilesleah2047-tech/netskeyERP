// Business-day helpers in Kenyan time (Africa/Nairobi, UTC+3, no DST).
//
// Servers (Vercel) run in UTC. Using the server clock directly made "today"
// start at 03:00 EAT, so sales between midnight and 3am landed on the
// previous day (pre-pilot review sections 2 and 4). Every business-day
// calculation should go through these helpers.

export const BUSINESS_TZ = "Africa/Nairobi";
const OFFSET_MS = 3 * 60 * 60 * 1000; // EAT is a fixed UTC+3

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of the Nairobi calendar day containing `at`. */
export function businessDate(at: Date = new Date()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function isBusinessDateString(s: string | null | undefined): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** UTC instants [start, end) bounding a Nairobi business day. */
export function businessDayRange(date: string = businessDate()): { start: Date; end: Date } {
  const start = new Date(new Date(date + "T00:00:00.000Z").getTime() - OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
