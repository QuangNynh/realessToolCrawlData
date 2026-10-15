export type SrtTiming = 'original' | 'previous-end-plus-10ms';
export const srtTimingNames: Record<SrtTiming, string> = {
  original: 'Giữ thời gian nhận dạng (hiện tại)',
  'previous-end-plus-10ms': 'Đầu đoạn sau = cuối đoạn trước + khoảng cách',
};

const stamp = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})';
const timingLine = new RegExp(`^\\s*${stamp}\\s*-->\\s*${stamp}(.*)$`);
const milliseconds = (parts: string[], offset: number) => ((+parts[offset] * 60 + +parts[offset + 1]) * 60 + +parts[offset + 2]) * 1000 + +parts[offset + 3];
const timestamp = (value: number) => {
  const hours = Math.floor(value / 3600000), minutes = Math.floor(value / 60000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`;
};

export function formatSrtTiming(content: string, mode: SrtTiming = 'original', audioDurationSeconds?: number, gapMs = 10): string {
  // Preserve the existing engine output byte-for-byte in the default mode.
  if (mode === 'original') return content;
  if (mode !== 'previous-end-plus-10ms') throw new Error('Cách xử lý thời gian SRT không hợp lệ');
  if (!Number.isSafeInteger(gapMs) || gapMs < 0) throw new Error('Khoảng cách phụ đề phải là số nguyên không âm (ms)');
  const cues = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n+/).map(block => {
    const lines = block.split('\n');
    const index = /^\d+$/.test(lines[0]?.trim()) ? 1 : 0;
    const match = lines[index]?.match(timingLine);
    if (!match || !lines.slice(index + 1).some(line => line.trim())) throw new Error('Không thể định dạng SRT: đoạn phụ đề không hợp lệ');
    const start = milliseconds(match, 1), end = milliseconds(match, 5);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new Error('Không thể định dạng SRT: mốc thời gian không hợp lệ');
    return { lines, index, start, end, suffix: match[9] };
  });
  const maximum = Number.isFinite(audioDurationSeconds) && audioDurationSeconds! > 0 ? Math.round(audioDurationSeconds! * 1000) : Infinity;
  return cues.map((cue, index) => {
    const previous = cues[index - 1];
    if (!previous) return cue.lines.join('\n');
    if (cue.start < previous.start) throw new Error('Không thể định dạng SRT: các đoạn không theo thứ tự thời gian');
    const start = previous.end + gapMs;
    if (!Number.isSafeInteger(start)) throw new Error('Khoảng cách phụ đề quá lớn');
    if (start >= cue.end || start >= maximum) throw new Error('Không thể định dạng SRT: đầu đoạn sau khi khớp mốc phải trước cuối đoạn và nằm trong audio');
    cue.lines[cue.index] = `${timestamp(start)} --> ${timestamp(cue.end)}${cue.suffix}`;
    return cue.lines.join('\n');
  }).join('\n\n') + '\n';
}
