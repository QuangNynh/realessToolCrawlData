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
  const uploaded = timestampDate(entry.timestamp) || calendarDate(entry.upload_date);
  const released = timestampDate(entry.release_timestamp) || calendarDate(entry.release_date);
  return {
    created_at: uploaded || released,
    // Flat tab entries derive upload time from "2 days/months/years ago".
    // A scheduled release timestamp comes from structured event data instead.
    created_at_is_approximate: Boolean(uploaded && ['url', 'url_transparent'].includes(entry._type || '')),
  };
}
