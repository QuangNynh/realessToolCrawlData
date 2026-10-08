export type DownloadErrorKind = 'rate_limit' | 'network' | 'unavailable' | 'filesystem' | 'unknown';

export function youtubeVideoId(value: string): string {
  if (typeof value !== 'string') throw new Error('URL YouTube không hợp lệ');
  value = value.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) throw new Error();
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch { /* Report the same validation error for all invalid inputs. */ }
  throw new Error(`Video ID hoặc URL YouTube không hợp lệ: ${value.slice(0, 120)}`);
}

export function classifyDownloadError(error: unknown): { kind: DownloadErrorKind; message: string; retryAfterMs: number } {
  const details = error as any;
  const message = String(details?.stderr || details?.message || error || 'Không thể tải file').slice(-4000);
  const status = Number(details?.response?.status || details?.statusCode || 0);
  const retryAfter = details?.response?.headers?.['retry-after'];
  const seconds = Number(retryAfter);
  const retryAfterMs = retryAfter == null ? 0 : Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(String(retryAfter)) - Date.now()) || 0;
  // Detect blocks before generic availability errors (bot pages may say "not available").
  if ([402, 429].includes(status) || /\b(?:402|429)\b|too many requests|rate.?limit|confirm you.?re not a bot|unusual traffic|temporarily blocked|request limit|try again later/i.test(message)) {
    return { kind: 'rate_limit', message, retryAfterMs };
  }
  if (/\b(?:ENOSPC|EACCES|EPERM|EROFS|ENOENT)\b|no space left|permission denied|read-only file system|cannot find.*(?:ffmpeg|yt-dlp)|unrecognized (?:option|argument)|no such option|unsupported.*javascript runtime/i.test(message)) {
    return { kind: 'filesystem', message, retryAfterMs: 0 };
  }
  if (/private video|video (?:has been )?(?:removed|deleted)|video unavailable|not available in your country|members.only|join this channel|age.restricted|confirm your age|sign in to confirm your age|copyright|account.*terminated|live event.*(?:begin|start)|this video is not available/i.test(message)) {
    return { kind: 'unavailable', message, retryAfterMs: 0 };
  }
  if ([403, 408, 500, 502, 503, 504].includes(status) || /\b(?:403|408|5\d\d)\b|\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE)\b|timed? out|timeout|connection|network|unable to download|remote end closed|incomplete|truncated|fragment.*(?:unavailable|not found)|file.*(?:empty|rỗng)/i.test(message)) {
    return { kind: 'network', message, retryAfterMs };
  }
  return { kind: 'unknown', message, retryAfterMs: 0 };
}

export function retryDelay(kind: DownloadErrorKind, attempts: number, random = Math.random): number {
  const base = kind === 'rate_limit' ? 120_000 : 15_000;
  const cap = kind === 'rate_limit' ? 60 * 60_000 : 15 * 60_000;
  return Math.min(cap, base * 2 ** Math.min(10, Math.max(0, attempts - 1))) * (1 + random() * 0.2);
}
