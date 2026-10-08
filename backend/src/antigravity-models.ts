import { AiError, AiModel } from './ai-types';

type Json = Record<string, any>;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w.():-]{1,180}$/.test(id);
// fetchAvailableModels includes retired IDs and command/tab models in `models`.
// Agent choices and the explicit retirement map determine usable chat IDs.
export function antigravityModels(data: Json) {
  const source = data.models || data.data;
  const entries: [string, Json][] = Array.isArray(source)
    ? source.map(item => typeof item === 'string' ? [item, {}] : [item?.id || item?.model || item?.name, item || {}])
    : source && typeof source === 'object' ? Object.entries(source) : [];
  const retired = new Set<string>();
  const replacements = new Map<string, string>();
  if (Array.isArray(data.deprecatedModelIds)) {
    for (const id of data.deprecatedModelIds) if (validId(id)) retired.add(id);
  } else if (data.deprecatedModelIds && typeof data.deprecatedModelIds === 'object') {
    for (const [id, info] of Object.entries(data.deprecatedModelIds) as [string, any][]) {
      if (!validId(id)) continue;
      retired.add(id);
      const replacement = typeof info === 'string' ? info : info?.newModelId;
      if (validId(replacement)) replacements.set(id, replacement);
    }
  }
  const agentIds = new Set<string>();
  for (const sort of Array.isArray(data.agentModelSorts) ? data.agentModelSorts : []) {
    for (const group of [sort, ...(Array.isArray(sort?.groups) ? sort.groups : [])]) {
      for (const id of Array.isArray(group?.modelIds) ? group.modelIds : []) if (validId(id)) agentIds.add(id);
    }
  }
  const imageIds = new Set<string>((Array.isArray(data.imageGenerationModelIds) ? data.imageGenerationModelIds : []).filter(validId));
  const models: AiModel[] = entries.filter(([id, info]) => validId(id) && info && !info.isInternal && !info.isDisabled && !info.isDeprecated && !retired.has(id)
    && (agentIds.size ? agentIds.has(id) || imageIds.has(id) : !/^(?:tab_|chat_)/.test(id)))
    .map(([id, info]) => ({ id: `ag/${id}`, name: typeof info.displayName === 'string' ? info.displayName : typeof info.name === 'string' ? info.name : id,
      kind: imageIds.has(id) || /image|imagen/i.test(id) ? 'image' : 'chat' }));
  if (!models.length) throw new AiError('Antigravity chưa trả về model khả dụng. Bấm làm mới hoặc kiểm tra tài khoản', 502, 'upstream_error');
  const unique = [...new Map(models.map(model => [model.id, model])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const available = new Set(unique.map(model => model.id));
  const aliases: Record<string, string> = {};
  for (const id of replacements.keys()) {
    let target = id;
    const seen = new Set<string>();
    while (replacements.has(target) && !seen.has(target)) { seen.add(target); target = replacements.get(target)!; }
    if (!seen.has(target) && available.has(`ag/${target}`)) aliases[`ag/${id}`] = `ag/${target}`;
  }
  const preferred = validId(data.defaultAgentModelId) ? aliases[`ag/${data.defaultAgentModelId}`] || `ag/${data.defaultAgentModelId}` : undefined;
  const defaultModelId = unique.find(model => model.id === preferred && model.kind === 'chat')?.id || unique.find(model => model.kind === 'chat')?.id || unique[0].id;
  return { models: unique, aliases, defaultModelId };
}
