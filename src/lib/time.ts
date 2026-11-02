const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok has no DST

/** "YYYY-MM-DD" of the current day in Asia/Bangkok. */
export function bangkokDay(d = new Date()): string {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO timestamp of the start of the current month in Asia/Bangkok. */
export function bangkokMonthStartIso(d = new Date()): string {
  const local = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(startLocal - BANGKOK_OFFSET_MS).toISOString();
}

export function nowIso() {
  return new Date().toISOString();
}

export function addSeconds(iso: string | Date, sec: number) {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + sec * 1000).toISOString();
}
