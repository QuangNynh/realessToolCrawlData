import { AiError } from './ai-types';
import type { ScriptInput, ConvertedScript } from './script-converter-types';

export const SCRIPT_TEXT_LIMIT = 8 * 1024 * 1024;
export function parseScripts(raw: unknown, mode: unknown = 'batch'): ScriptInput[] {
  if (typeof raw !== 'string' || !raw.trim()) throw new AiError('Nhập hoặc tải file kịch bản trước');
  if (Buffer.byteLength(raw, 'utf8') > SCRIPT_TEXT_LIMIT) throw new AiError('File kịch bản vượt quá 8 MB', 413);
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (mode === 'single') return [{ id: '1', indexText: '1.', link: '', title: 'Kịch bản đơn', content: text }];
  if (mode !== 'batch') throw new AiError('Chế độ nhập không hợp lệ');
  const lines = text.split('\n');
  const headers: { start: number; body: number; indexText: string; link: string; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+\.$/.test(lines[i].trim())) continue;
    let linkLine = i + 1;
    while (linkLine < lines.length && !lines[linkLine].trim()) linkLine++;
    if (!safeScriptUrl(lines[linkLine]?.trim())) continue;
    let titleLine = linkLine + 1;
    while (titleLine < lines.length && !lines[titleLine].trim()) titleLine++;
    if (titleLine >= lines.length) throw new AiError(`Thiếu tiêu đề ở kịch bản ${lines[i].trim()}`);
    headers.push({ start: i, body: titleLine + 1, indexText: lines[i].trim(), link: lines[linkLine].trim(), title: lines[titleLine].trim() });
    i = titleLine;
  }
  if (!headers.length) throw new AiError('Không tìm thấy kịch bản. Dùng định dạng số thứ tự, URL, tiêu đề, nội dung hoặc chọn Kịch bản đơn');
  if (lines.slice(0, headers[0].start).some(line => line.trim())) throw new AiError('Có nội dung trước kịch bản đầu tiên. Kiểm tra định dạng file');
  if (headers.length > 1000) throw new AiError('Mỗi đợt tối đa 1.000 kịch bản');
  return headers.map((header, i) => {
    const content = lines.slice(header.body, headers[i + 1]?.start).join('\n').trim();
    if (!content) throw new AiError(`Kịch bản ${header.indexText} không có nội dung`);
    // Internal IDs remain unique even if the source file repeats an index.
    return { id: String(i + 1), indexText: header.indexText, link: header.link, title: header.title, content };
  });
}
export function safeScriptUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol)) return url.toString(); } catch { /* Plain text, not a link. */ }
}
export function scriptPrompt(template: unknown, content: string): string {
  if (typeof template !== 'string' || !template.includes('[SCRIPT]')) throw new AiError('Prompt bắt buộc chứa [SCRIPT]');
  const pieces = template.split('[SCRIPT]');
  if (template.length + (pieces.length - 1) * (content.length - 8) > 100_000) throw new AiError('Prompt cùng nội dung mỗi kịch bản tối đa 100.000 ký tự');
  const prompt = pieces.join(content);
  return prompt;
}
const escaped = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const mainText = (script: ConvertedScript) => script.status === 'completed' && script.result ? script.result : script.content;
export const exportScriptsText = (scripts: ConvertedScript[]) => scripts.map(s => `${s.indexText}\n${s.link}\n\n${s.title}\n\n${mainText(s)}`).join('\n\n\n\n');
function markdownHtml(text: string) {
  const tokens = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let html = '', end = 0;
  for (const match of text.matchAll(tokens)) {
    html += escaped(text.slice(end, match.index));
    if (match[1]) html += safeScriptUrl(match[2]) ? `<a href="${escaped(match[2])}">${escaped(match[1])}</a>` : escaped(match[0]);
    else if (match[3]) html += `<strong>${escaped(match[3])}</strong>`;
    else html += `<em>${escaped(match[4] || match[5])}</em>`;
    end = match.index! + match[0].length;
  }
  return (html + escaped(text.slice(end))).replace(/\n/g, '<br/>');
}
export function exportScriptsDoc(scripts: ConvertedScript[]) {
  const blocks = scripts.map(s => {
    // Escape source and model output before adding the small supported Markdown subset.
    const body = markdownHtml(mainText(s));
    const link = safeScriptUrl(s.link) ? `<a href="${escaped(s.link)}">${escaped(s.link)}</a>` : escaped(s.link);
    return `<div class="script-block">${escaped(s.indexText)}<br/>${link}<br/><br/>${escaped(s.title)}<br/><br/>${body}</div>`;
  }).join('\n');
  return `\uFEFF<!doctype html><html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Kịch bản chuyển đổi</title><style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5}.script-block{margin-bottom:24pt}a{color:#0563c1}</style></head><body>${blocks}</body></html>`;
}
