import { createHash, randomUUID } from 'node:crypto';
import { AiError } from './ai-types';

type Json = Record<string, any>;
const object = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const functionName = (name: unknown) => {
  if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/.test(name)) throw new AiError('Tên function không hợp lệ');
  return name;
};
const parseJson = (value: string) => { try { return JSON.parse(value); } catch { throw new AiError('Arguments của tool phải là JSON hợp lệ'); } };

function parts(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (content == null) return [];
  if (!Array.isArray(content)) throw new AiError('Content phải là chuỗi hoặc mảng text/image_url');
  return content.map(item => {
    if (item?.type === 'text' && typeof item.text === 'string') return { text: item.text };
    if (item?.type === 'image_url') {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(item.image_url?.url || '');
      if (!match) throw new AiError('Ảnh đầu vào cần image_url dạng data:image/...;base64,...');
      return { inlineData: { mimeType: match[1], data: match[2] } };
    }
    throw new AiError('Chỉ hỗ trợ content kiểu text và image_url');
  });
}

export function buildAntigravityRequest(body: unknown, model: string, projectId: string) {
  if (!object(body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 500) throw new AiError('Cần messages gồm 1 đến 500 tin nhắn');
  if (body.stream != null && typeof body.stream !== 'boolean') throw new AiError('stream phải là boolean');
  const contents: Json[] = [];
  const systemParts: Json[] = [];
  const calls = new Map<string, { name: string; used: boolean }>();
  for (const message of body.messages) {
    if (!object(message)) throw new AiError('Tin nhắn không hợp lệ');
    if (message.role === 'system' || message.role === 'developer') { systemParts.push(...parts(message.content)); continue; }
    if (message.role === 'tool') {
      const call = calls.get(message.tool_call_id);
      if (!call || call.used) throw new AiError('tool_call_id không khớp với lời gọi tool trước đó');
      call.used = true;
      let response: unknown = message.content;
      if (typeof response === 'string') { try { response = JSON.parse(response); } catch { response = { result: response }; } }
      if (!object(response)) response = { result: response };
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response } }] });
      continue;
    }
    if (!['user', 'assistant'].includes(message.role)) throw new AiError('Role hỗ trợ: system, developer, user, assistant, tool');
    const messageParts = parts(message.content);
    if (message.tool_calls != null) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) throw new AiError('tool_calls phải thuộc tin nhắn assistant');
      for (const call of message.tool_calls) {
        const name = functionName(call?.function?.name);
        if (typeof call.id !== 'string' || calls.has(call.id) || typeof call.function.arguments !== 'string') throw new AiError('Tool call không hợp lệ');
        calls.set(call.id, { name, used: false });
        const signature = call.extra_content?.google?.thought_signature;
        messageParts.push({ functionCall: { name, args: parseJson(call.function.arguments) }, ...(typeof signature === 'string' ? { thoughtSignature: signature } : {}) });
      }
    }
    if (messageParts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: messageParts });
  }
  if (!contents.length) throw new AiError('Cần ít nhất một tin nhắn user hoặc assistant');
  const generationConfig: Json = {};
  for (const [from, to, max] of [['temperature', 'temperature', 2], ['top_p', 'topP', 1]] as const) {
    if (body[from] != null) {
      if (typeof body[from] !== 'number' || !Number.isFinite(body[from]) || body[from] < 0 || body[from] > max) throw new AiError(`${from} ngoài khoảng hợp lệ`);
      generationConfig[to] = body[from];
    }
  }
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (maxTokens != null) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 64000) throw new AiError('max_tokens cần từ 1 đến 64.000');
    generationConfig.maxOutputTokens = maxTokens;
  }
  if (body.n != null && body.n !== 1) throw new AiError('Chỉ hỗ trợ n = 1');
  if (body.stop != null) {
    const stop = typeof body.stop === 'string' ? [body.stop] : body.stop;
    if (!Array.isArray(stop) || stop.length > 5 || stop.some(item => typeof item !== 'string')) throw new AiError('stop cần tối đa 5 chuỗi');
    generationConfig.stopSequences = stop;
  }
  if (body.response_format?.type === 'json_object') generationConfig.responseMimeType = 'application/json';
  else if (body.response_format?.type === 'json_schema') {
    if (!object(body.response_format.json_schema?.schema)) throw new AiError('json_schema.schema không hợp lệ');
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = body.response_format.json_schema.schema;
  } else if (body.response_format != null && body.response_format.type !== 'text') throw new AiError('response_format chưa được hỗ trợ');
  const request: Json = { contents, generationConfig };
  // Keep one numeric session identifier across a conversation, without sending
  // API keys or account identifiers as the session identifier.
  const seed = JSON.stringify(contents[0]) + model + projectId;
  request.sessionId = (BigInt('0x' + createHash('sha256').update(seed).digest('hex').slice(0, 16)) & 0x7fffffffffffffffn).toString();
  if (systemParts.length) request.systemInstruction = { parts: systemParts };
  if (body.tools != null) {
    if (!Array.isArray(body.tools) || body.tools.length > 128) throw new AiError('tools cần là mảng tối đa 128 function');
    const names = new Set<string>();
    const declarations = body.tools.map(tool => {
      if (tool?.type !== 'function') throw new AiError('Chỉ hỗ trợ tool kiểu function');
      const name = functionName(tool.function?.name);
      if (names.has(name)) throw new AiError('Tên tool bị trùng');
      names.add(name);
      const schema = tool.function.parameters ?? { type: 'object', properties: {} };
      if (!object(schema)) throw new AiError('Parameters của tool cần là JSON schema');
      return { name, description: tool.function.description || '', parametersJsonSchema: schema };
    });
    if (declarations.length) request.tools = [{ functionDeclarations: declarations }];
    if (body.tool_choice) {
      const choice = body.tool_choice;
      const name = choice?.function?.name;
      if (typeof choice === 'string' && ['auto', 'none', 'required'].includes(choice)) request.toolConfig = { functionCallingConfig: { mode: { auto: 'AUTO', none: 'NONE', required: 'ANY' }[choice] } };
      else if (choice?.type === 'function' && names.has(name)) request.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [name] } };
      else throw new AiError('tool_choice không hợp lệ');
    }
  }
  const image = /image|imagen/i.test(model);
  if (image) { generationConfig.responseModalities = ['TEXT', 'IMAGE']; delete request.tools; delete request.toolConfig; }
  const requestId = `agent/${randomUUID()}/${Date.now()}/${randomUUID()}/${Math.max(1, contents.length * 2 - 1)}`;
  return { project: projectId, model, userAgent: 'antigravity', requestId, ...(image ? { requestType: 'image_gen' } : {}), request };
}

export const unwrapAntigravity = (value: Json): Json => object(value?.response) ? value.response : value;
export function usageOf(value: Json) {
  const usage = value.usageMetadata || {};
  const prompt = usage.promptTokenCount || 0;
  const completion = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: usage.totalTokenCount ?? prompt + completion };
}
export function responseDelta(value: Json, toolOffset = 0) {
  const candidate = value.candidates?.[0];
  if (!candidate && value.promptFeedback?.blockReason) throw new AiError('Antigravity đã chặn nội dung yêu cầu', 400, 'content_filter');
  const parts = candidate?.content?.parts || [];
  const delta: Json = {};
  const text = parts.filter((part: Json) => typeof part.text === 'string' && !part.thought).map((part: Json) => part.text).join('');
  const reasoning = parts.filter((part: Json) => typeof part.text === 'string' && part.thought).map((part: Json) => part.text).join('');
  if (text) delta.content = text;
  if (reasoning) delta.reasoning_content = reasoning;
  const images = parts.filter((part: Json) => part.inlineData?.data).map((part: Json) => ({ type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}` } }));
  if (images.length) delta.content = [...(text ? [{ type: 'text', text }] : []), ...images];
  const calls = parts.filter((part: Json) => part.functionCall).map((part: Json, index: number) => ({
    index: toolOffset + index, id: `call_${randomUUID()}`, type: 'function',
    function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
    ...(part.thoughtSignature ? { extra_content: { google: { thought_signature: part.thoughtSignature } } } : {}),
  }));
  if (calls.length) delta.tool_calls = calls;
  const reason = candidate?.finishReason;
  const finishReason = !reason ? null : calls.length ? 'tool_calls' : reason === 'MAX_TOKENS' ? 'length' : ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(reason) ? 'content_filter' : 'stop';
  return { delta, finishReason, toolCount: calls.length };
}
export function completionOf(raw: Json, model: string) {
  const value = unwrapAntigravity(raw);
  const { delta, finishReason, toolCount } = responseDelta(value);
  if (!value.candidates?.length) throw new AiError('Antigravity trả về phản hồi rỗng', 502, 'upstream_error');
  if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map(({ index: _index, ...call }: Json) => call);
  return { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content: null, ...delta }, finish_reason: toolCount ? 'tool_calls' : finishReason || 'stop' }], usage: usageOf(value) };
}

export async function* readAntigravitySse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (block: string) => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data.trim() === '[DONE]') return null;
    try { return JSON.parse(data); } catch { throw new AiError('Antigravity trả về stream không hợp lệ', 502, 'upstream_error'); }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const parsed = parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (parsed) yield parsed;
      }
      if (buffer.length > 16 * 1024 * 1024) throw new AiError('Khung stream quá lớn', 502, 'upstream_error');
      if (done) break;
    }
    if (buffer.trim()) { const parsed = parse(buffer); if (parsed) yield parsed; }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
