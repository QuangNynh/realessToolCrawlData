function timestampDate(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return /^\d{4}-/.test(iso) ? iso : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return date.toISOString();
}

export function youtubeVideoDate(entry: { _type?: string; timestamp?: unknown; upload_date?: unknown; release_timestamp?: unknown; release_date?: unknown }) {
  // Flat playlist dates may be inferred from relative labels, never treat them as exact.
  if (['url', 'url_transparent'].includes(entry._type || '')) return { created_at: null, created_at_is_approximate: false };
  const uploaded = calendarDate(entry.upload_date) || timestampDate(entry.timestamp);
  return { created_at: uploaded, created_at_is_approximate: false };
}
