const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const express = require('express');
const { AiGateway } = require('../dist-backend/ai-gateway');
const { mountAiRoutes } = require('../dist-backend/ai-routes');
const { buildAntigravityRequest, completionOf } = require('../dist-backend/antigravity-format');
const { antigravityModels } = require('../dist-backend/antigravity-models');

const json = (value, status = 200, headers) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const catalog = { models: { 'gemini-test': { displayName: 'Gemini Test' }, 'claude-test': { displayName: 'Claude Test' }, 'gemini-image-test': {}, internal: { isInternal: true } } };
const output = text => ({ response: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } } });
const currentCatalog = {
  models: { 'gemini-3.1-pro-high': { displayName: 'Retired Gemini Pro' }, 'gemini-pro-agent': { displayName: 'Gemini Pro' },
    'gemini-3.8-flash-high': { displayName: 'Gemini Flash' }, 'gemini-3-flash': { displayName: 'Command model' }, 'tab_flash_lite_preview': {},
    'gemini-image-test': {}, 'retired-without-replacement': {}, 'disabled-agent': { isDisabled: true } },
  defaultAgentModelId: 'gemini-3.8-flash-high',
  agentModelSorts: [{ displayName: 'Recommended', groups: [{ modelIds: ['gemini-pro-agent', 'gemini-3.8-flash-high', 'disabled-agent'] }] }],
  imageGenerationModelIds: ['gemini-image-test'],
  deprecatedModelIds: { 'gemini-3.1-pro-high': { newModelId: 'gemini-pro-agent' }, 'retired-without-replacement': {},
    'old-chain': { newModelId: 'gemini-3.1-pro-high' }, 'cycle-a': { newModelId: 'cycle-b' }, 'cycle-b': { newModelId: 'cycle-a' } },
};
const wait = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Timed out');
};
function setup(t, handler) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-ai-test-'));
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (handler) { const result = await handler(String(url), options); if (result) return result; }
    if (String(url).endsWith('/token')) return json({ access_token: 'ya29.test-account-token', refresh_token: 'test-refresh-token', expires_in: 3600 });
    if (String(url).includes('/userinfo')) return json({ email: 'tester@example.com' });
    if (String(url).endsWith(':loadCodeAssist')) return json({ cloudaicompanionProject: 'test-project' });
    if (String(url).endsWith(':fetchAvailableModels')) return json(catalog);
    if (String(url).endsWith(':generateContent')) return json(output('Xin chào từ model'));
    throw new Error('Unexpected external call: ' + url);
  };
  const gateway = new AiGateway(directory, fetcher);
  t.after(() => { gateway.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { gateway, directory, calls, fetcher };
}
async function connect(gateway) {
  const result = await gateway.beginConnect();
  const url = new URL(result.authUrl);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'test-auth-code' });
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  await response.text();
  await wait(() => !gateway.snapshot().connecting);
  assert.equal(gateway.snapshot().connected, true, gateway.snapshot().error);
  return url;
}
async function listen(t, gateway) {
  const app = express();
  app.use(express.json());
  mountAiRoutes(app, () => gateway);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('personal keys persist as hashes, remain valid after restart, and can be revoked individually', t => {
  const { gateway, directory, fetcher } = setup(t);
  const first = gateway.createKey('Key cá nhân');
  const second = gateway.createKey('Key khác');
  assert.match(first.createdKey.key, /^sk-crawldata-[\w-]{43}$/);
  assert.notEqual(first.createdKey.key, second.createdKey.key);
  assert.equal('hash' in first.keys[0], false);
  assert.equal('key' in first.keys[0], false);
  assert.ok(!fs.readFileSync(path.join(directory, 'state.enc')).includes(Buffer.from(first.createdKey.key)));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'state.enc')).mode & 0o777, 0o600);
  const restored = new AiGateway(directory, fetcher);
  assert.doesNotThrow(() => restored.authenticate(first.createdKey.key));
  restored.revokeKey(first.createdKey.id);
  assert.throws(() => restored.authenticate(first.createdKey.key), error => error.status === 401);
  assert.doesNotThrow(() => restored.authenticate(second.createdKey.key));
  assert.throws(() => restored.authenticate('sk-crawldata-invented'), error => error.status === 401);
  assert.throws(() => restored.createKey('   '), /Tên key/);
  restored.shutdown();
});

test('the Google catalog filters retired/non-agent IDs, follows replacement chains and prefers its recommended default', () => {
  const parsed = antigravityModels(currentCatalog);
  assert.deepEqual(parsed.models.map(m => m.id), ['ag/gemini-3.8-flash-high', 'ag/gemini-image-test', 'ag/gemini-pro-agent']);
  assert.equal(parsed.aliases['ag/gemini-3.1-pro-high'], 'ag/gemini-pro-agent');
  assert.equal(parsed.aliases['ag/old-chain'], 'ag/gemini-pro-agent');
  assert.equal(parsed.aliases['ag/cycle-a'], undefined);
  assert.equal(parsed.aliases['ag/retired-without-replacement'], undefined);
  assert.equal(parsed.defaultModelId, 'ag/gemini-3.8-flash-high');
});

test('desktop and public API resolve retired Gemini IDs before upstream; live HTTP errors identify the chosen model', async t => {
  let fail = false;
  const { gateway, calls } = setup(t, async (url, options) => {
    if (url.endsWith(':fetchAvailableModels')) return json(currentCatalog);
    if (url.endsWith(':generateContent')) {
      const body = JSON.parse(options.body);
      if (body.model === 'gemini-3.1-pro-high') return json({ error: { status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } }, 400);
      if (fail) return json({ error: { message: 'Request contains an invalid argument. ya29.test-account-token' } }, 400);
    }
  });
  await connect(gateway);
  const key = gateway.createKey('Existing personal key').createdKey;
  let reply = await gateway.dispatch({ action: 'chat', model: 'ag/gemini-3.1-pro-high', apiKey: key.key, prompt: 'Xin chào' });
  assert.equal(reply.model, 'ag/gemini-pro-agent');
  assert.equal(reply.choices[0].message.content, 'Xin chào từ model');
  reply = await gateway.desktopChat(key.id, { model: 'gemini-3.1-pro-high', messages: [{ role: 'user', content: 'Đổi kịch bản' }] });
  assert.equal(reply.model, 'ag/gemini-pro-agent');
  const base = await listen(t, gateway);
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'ag/gemini-3.1-pro-high', messages: [{ role: 'user', content: 'Xin chào' }] }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).model, 'ag/gemini-pro-agent');
  assert.ok(calls.filter(call => call.url.endsWith(':generateContent')).every(call => JSON.parse(call.options.body).model === 'gemini-pro-agent'));
  assert.ok(!gateway.snapshot().models.some(m => m.id === 'ag/gemini-3.1-pro-high'));
  fail = true;
  await assert.rejects(gateway.dispatch({ action: 'chat', model: 'ag/gemini-pro-agent', apiKey: key.key, prompt: 'Test' }), error => error.status === 400
    && error.message.includes('ag/gemini-pro-agent') && error.message.includes('HTTP 400') && !error.message.includes('ya29.test-account-token'));
});

test('status migrates a legacy model cache without invalidating personal keys', async t => {
  const { gateway, directory, fetcher, calls } = setup(t, async url => url.endsWith(':fetchAvailableModels') ? json(currentCatalog) : undefined);
  await connect(gateway);
  const key = gateway.createKey('Keep key').createdKey;
  const { AiStore } = require('../dist-backend/ai-store');
  const store = new AiStore(directory);
  store.save({ ...store.state, modelAliases: undefined, defaultModelId: undefined,
    models: [{ id: 'ag/gemini-3.1-pro-high', name: 'Old model', kind: 'chat' }], modelsUpdatedAt: new Date().toISOString() });
  const restored = new AiGateway(directory, fetcher);
  t.after(() => restored.shutdown());
  const before = calls.filter(call => call.url.endsWith(':fetchAvailableModels')).length;
  const state = await restored.dispatch({ action: 'status' });
  assert.equal(state.defaultModelId, 'ag/gemini-3.8-flash-high');
  assert.equal(state.modelAliases['ag/gemini-3.1-pro-high'], 'ag/gemini-pro-agent');
  assert.doesNotThrow(() => restored.authenticate(key.key));
  await restored.dispatch({ action: 'status' });
  assert.equal(calls.filter(call => call.url.endsWith(':fetchAvailableModels')).length, before + 1);
});

test('OAuth validates state and PKCE, discovers models, and never exposes account tokens', async t => {
  const { gateway, directory, calls, fetcher } = setup(t);
  const start = await gateway.beginConnect();
  const url = new URL(start.authUrl);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ state: 'wrong', code: 'wrong-code' });
  const bad = await fetch(callback);
  assert.equal(bad.status, 400); await bad.text();
  assert.equal(calls.length, 0);
  callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'test-auth-code' });
  const good = await fetch(callback); assert.equal(good.status, 200); await good.text();
  await wait(() => !gateway.snapshot().connecting);
  const snapshot = gateway.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.email, 'tester@example.com');
  assert.deepEqual(snapshot.models.map(model => model.id), ['ag/claude-test', 'ag/gemini-image-test', 'ag/gemini-test']);
  const tokenCall = calls.find(call => call.url.endsWith('/token'));
  const verifier = tokenCall.options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.ok(!JSON.stringify(snapshot).includes('ya29.test-account-token'));
  assert.ok(!JSON.stringify(snapshot).includes('test-refresh-token'));
  assert.ok(!fs.readFileSync(path.join(directory, 'state.enc')).includes(Buffer.from('test-refresh-token')));
  const restored = new AiGateway(directory, fetcher);
  assert.equal(restored.snapshot().connected, true);
  assert.equal(restored.snapshot().models.length, 3);
  restored.shutdown();
});

test('cancelled OAuth cannot write a late connection; disconnect retains personal keys', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { gateway } = setup(t, async url => { if (url.endsWith('/token')) { await gate; return json({ access_token: 'late-token', refresh_token: 'late-refresh', expires_in: 3600 }); } });
  const first = gateway.createKey('Retain me');
  const result = await gateway.beginConnect();
  const auth = new URL(result.authUrl);
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code' });
  const response = await fetch(callback); await response.text();
  gateway.cancelConnect(); release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(gateway.snapshot().connected, false);
  gateway.disconnect();
  assert.doesNotThrow(() => gateway.authenticate(first.createdKey.key));
});

test('one personal key calls every discovered model; API and management enforce separate access', async t => {
  const { gateway, calls } = setup(t);
  await connect(gateway);
  const key = gateway.createKey('All models').createdKey.key;
  const base = await listen(t, gateway);
  let response = await fetch(base + '/v1/models'); assert.equal(response.status, 401); await response.text();
  response = await fetch(base + '/api/v1/internal/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ action: 'create-key', name: 'attack' }) });
  assert.equal(response.status, 403); await response.text();
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  response = await fetch(base + '/v1/models', { headers });
  const listed = await response.json(); assert.equal(listed.data.length, 3);
  for (const model of listed.data) {
    response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'Xin chào' }] }) });
    assert.equal(response.status, 200);
    const reply = await response.json(); assert.equal(reply.model, model.id); assert.equal(reply.choices[0].message.content, 'Xin chào từ model'); assert.equal(reply.usage.total_tokens, 5);
  }
  const upstream = calls.filter(call => call.url.endsWith(':generateContent'));
  assert.equal(upstream.length, 3);
  assert.ok(upstream.every(call => call.options.headers.Authorization === 'Bearer ya29.test-account-token'));
  assert.ok(upstream.every(call => !JSON.stringify(call.options).includes(key)));
  response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: 'ag/unlisted', messages: [{ role: 'user', content: 'x' }] }) });
  assert.equal(response.status, 404); await response.text();
  gateway.revokeKey(gateway.snapshot().keys[0].id);
  response = await fetch(base + '/v1/models', { headers }); assert.equal(response.status, 401); await response.text();
});

test('concurrent 401 responses share one token refresh; upstream quota failures propagate without a retry loop', async t => {
  let refreshes = 0;
  let limited = false;
  const { gateway } = setup(t, async (url, options) => {
    if (url.endsWith('/token') && options.body.get('grant_type') === 'refresh_token') {
      refreshes++; await new Promise(resolve => setTimeout(resolve, 20));
      return json({ access_token: 'ya29.refreshed', expires_in: 3600 });
    }
    if (url.endsWith(':generateContent')) {
      if (limited) return json({ error: { message: 'Quota exhausted' } }, 429, { 'Retry-After': '60' });
      if (options.headers.Authorization.endsWith('test-account-token')) return json({ error: { message: 'Expired' } }, 401);
      return json(output('refreshed'));
    }
  });
  await connect(gateway);
  const key = gateway.createKey('Refresh').createdKey.key;
  const body = { model: 'ag/gemini-test', messages: [{ role: 'user', content: 'test' }] };
  const replies = await Promise.all([gateway.chat(key, body), gateway.chat(key, body)]);
  assert.equal(refreshes, 1); assert.ok(replies.every(reply => reply.choices[0].message.content === 'refreshed'));
  limited = true;
  const base = await listen(t, gateway);
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  assert.match((await response.json()).error.message, /ag\/gemini-test.*HTTP 429: Quota exhausted$/);
  assert.equal(refreshes, 1);
});

test('chat SSE handles fragmented UTF-8 and CRLF, emits content and usage, and finishes with DONE', async t => {
  const { gateway } = setup(t, url => {
    if (url.includes(':streamGenerateContent')) {
      const source = Buffer.from([`data: ${JSON.stringify(output('Xin chào'))}\r\n\r\n`, `data: ${JSON.stringify(output(' thế giới'))}\r\n\r\n`].join(''));
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < source.length; i += 7) controller.enqueue(source.subarray(i, i + 7)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
  });
  await connect(gateway);
  const key = gateway.createKey('Streaming').createdKey.key;
  const base = await listen(t, gateway);
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'ag/gemini-test', stream: true, messages: [{ role: 'user', content: 'x' }] }) });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const text = await response.text(); assert.ok(text.endsWith('data: [DONE]\n\n'));
  const chunks = text.split('\n\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert.equal(chunks.map(chunk => chunk.choices[0].delta.content || '').join(''), 'Xin chào thế giới');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop'); assert.equal(chunks.at(-1).usage.total_tokens, 5);
});

test('tool calls preserve signatures and arguments across a round trip; image input and output are supported', () => {
  const result = completionOf({ candidates: [{ content: { parts: [{ functionCall: { name: 'weather', args: { city: 'Hanoi' } }, thoughtSignature: 'signature-123' }] }, finishReason: 'STOP' }] }, 'ag/gemini-test');
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  const call = result.choices[0].message.tool_calls[0];
  const request = buildAntigravityRequest({ messages: [
    { role: 'system', content: 'Assist me' }, { role: 'user', content: 'Weather?' }, result.choices[0].message,
    { role: 'tool', tool_call_id: call.id, content: '{"temperature":30}' },
  ], tools: [{ type: 'function', function: { name: 'weather', parameters: { type: 'object', properties: {} } } }], tool_choice: 'auto' }, 'gemini-test', 'project');
  assert.equal(request.request.contents[1].parts[0].thoughtSignature, 'signature-123');
  assert.equal(request.request.contents[2].parts[0].functionResponse.name, 'weather');
  assert.deepEqual(request.request.contents[2].parts[0].functionResponse.response, { temperature: 30 });
  assert.throws(() => buildAntigravityRequest({ messages: [{ role: 'tool', tool_call_id: 'missing', content: 'x' }] }, 'm', 'p'), /tool_call_id/);
  const image = buildAntigravityRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }] }, 'gemini-image-test', 'project');
  assert.deepEqual(image.request.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  const answer = completionOf({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }] }, finishReason: 'STOP' }] }, 'ag/gemini-image-test');
  assert.equal(answer.choices[0].message.content[0].image_url.url, 'data:image/png;base64,YQ==');
  assert.throws(() => buildAntigravityRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/private' } }] }] }, 'm', 'p'), /data:image/);
});
