import type { AiModel } from './ai-types';
export interface AiQuotaRow { id: string; name: string; remaining: number; resetAt: string | null; group: 'model' | 'session' | 'weekly' }
export interface AiQuotaSnapshot {
  accountId: string; email?: string; plan: string; updatedAt: string; rows: AiQuotaRow[]; message?: string;
}
const resetDate = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const fraction = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
export function parseAntigravityQuota(models: Record<string, any>, summary: Record<string, any>, subscription: Record<string, any>, available: AiModel[]): AiQuotaRow[] {
  const rows: AiQuotaRow[] = [];
  const allowed = new Set(available.map(model => model.id.replace(/^ag\//, '')));
  // 9router only exposes individual model limits for paid tiers.
  if (subscription.paidTier?.id && subscription.paidTier.id !== 'free-tier') {
    for (const [id, value] of Object.entries(models.models || {}) as [string, any][]) {
      if (!allowed.has(id) || value?.isInternal) continue;
      const remaining = fraction(value?.quotaInfo?.remainingFraction);
      if (remaining === null) continue;
      rows.push({ id, name: value.displayName || available.find(model => model.id === `ag/${id}`)?.name || id,
        remaining: remaining * 100, resetAt: resetDate(value.quotaInfo.resetTime), group: 'model' });
    }
  }
  const groups = Array.isArray(summary.groups) ? summary.groups : Array.isArray(summary.quotaSummary?.groups) ? summary.quotaSummary.groups : [];
  const added = new Set<string>();
  for (const group of groups) {
    const family = /gemini/i.test(group?.displayName || '') ? 'gemini' : /claude|gpt/i.test(group?.displayName || '') ? 'claude_gpt' : null;
    if (!family) continue;
    for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
      const label = `${bucket?.bucketId || ''} ${bucket?.displayName || ''}`.toLowerCase();
      const window = String(bucket?.window || '').toLowerCase();
      const type = window === 'weekly' || label.includes('weekly') ? 'weekly'
        : ['5h', 'daily'].includes(window) || /five hour|5h|daily/.test(label) ? 'session' : null;
      if (!type || (type === 'weekly' && bucket.disabled === true)) continue;
      const remaining = bucket.disabled === true ? 0 : fraction(bucket.remainingFraction);
      const id = `${family}_${type}`;
      if (remaining === null || added.has(id)) continue;
      added.add(id);
      const row: AiQuotaRow = { id, name: `${family === 'gemini' ? 'Gemini' : 'Claude & GPT'} (${type === 'weekly' ? 'Weekly' : '5h'})`, remaining: remaining * 100, resetAt: resetDate(bucket.resetTime), group: type };
      // Match 9router: model exhaustion can precede the summary update.
      const related = rows.filter(item => item.group === 'model' && (family === 'gemini' ? /^gemini-/i.test(item.id) && !/image/i.test(item.id) : /^claude-/i.test(item.id)));
      if (type === 'session' && related.length && related.every(item => item.remaining === 0) && row.remaining > 0) {
        row.remaining = 0;
        row.resetAt = related.map(item => item.resetAt).filter((date): date is string => Boolean(date)).sort().at(-1) || row.resetAt;
      }
      rows.push(row);
    }
  }
  return rows;
}
