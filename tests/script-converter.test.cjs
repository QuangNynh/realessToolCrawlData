const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { AiGateway } = require('../dist-backend/ai-gateway');
const { AiStore } = require('../dist-backend/ai-store');
const { AiError } = require('../dist-backend/ai-types');
const { ScriptConverter } = require('../dist-backend/script-converter');
const { mountScriptConverterRoutes } = require('../dist-backend/script-converter-routes');
const { parseScripts, scriptPrompt, exportScriptsDoc, exportScriptsText } = require('../dist-backend/script-converter-format');

const raw = (count = 3) => Array.from({ length: count }, (_, i) => `${i + 1}.\nhttps://youtube.com/watch?v=test${i}\n\nTiêu đề ${i + 1}\n\nKịch bản ${i + 1} – tiếng Việt`).join('\n\n\n\n');
const reply = text => ({ choices: [{ finish_reason: 'stop', message: { content: text } }] });
const wait = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out'); };
function setup(t, handler) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-script-test-'));
  const calls = [];
  const gateway = {
    snapshot: () => ({ connected: true, models: [{ id: 'ag/test', kind: 'chat' }, { id: 'ag/other', kind: 'chat' }, { id: 'ag/image', kind: 'image' }], keys: [{ id: 'key-id' }] }),
    validateDesktopKey: id => { if (id !== 'key-id') throw new AiError('Key đã thu hồi', 401); },
    desktopChat: async (id, body, signal) => { gateway.validateDesktopKey(id); calls.push({ id, body, signal }); return handler ? handler(id, body, signal, calls.length) : reply('Đã đổi: ' + body.messages[0].content); },
  };
  const converter = new ScriptConverter(directory, () => gateway, 5);
  const input = { action: 'create', rawText: raw(), mode: 'batch', keyId: 'key-id', model: 'ag/test', prompt: 'Dịch: [SCRIPT]', name: 'Kiểm tra' };
  t.after(() => { converter.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { converter, gateway, directory, calls, input };
}

test('imports the original numbered TXT format, CRLF/BOM, duplicate indices and numbered content without losing text', () => {
  const input = '\uFEFF' + raw(2).replace('Kịch bản 1 – tiếng Việt', 'Nội dung đầu\n2.\nĐây là danh sách trong kịch bản').replace('2.\nhttps:', '1.\nhttps:').replace(/\n/g, '\r\n');
  const scripts = parseScripts(input);
  assert.equal(scripts.length, 2); assert.deepEqual(scripts.map(s => s.id), ['1', '2']);
  assert.deepEqual(scripts.map(s => s.indexText), ['1.', '1.']);
  assert.match(scripts[0].content, /2\.\nĐây là danh sách/);
  assert.equal(scripts[1].title, 'Tiêu đề 2');
  assert.equal(parseScripts('Văn bản tự do', 'single')[0].content, 'Văn bản tự do');
  assert.throws(() => parseScripts('Không đúng định dạng'), /Không tìm thấy/);
  assert.throws(() => parseScripts(raw(1001)), /1.000/);
  assert.throws(() => scriptPrompt('Không có placeholder', 'x'), /\[SCRIPT\]/);
  assert.throws(() => scriptPrompt('[SCRIPT]', 'x'.repeat(100001)), /100.000/);
  assert.equal(scriptPrompt('[SCRIPT] / [SCRIPT]', '$& $`'), '$& $` / $& $`');
});

test('sequential conversion retries temporary failures once, retains successes and restarts only failed items', async t => {
  let inflight = 0, max = 0, fail = true;
  const { converter, input, calls } = setup(t, async (_id, body) => {
    inflight++; max = Math.max(max, inflight);
    await new Promise(resolve => setTimeout(resolve, 5)); inflight--;
    const prompt = body.messages[0].content;
    if (prompt.includes('Kịch bản 2') && fail) throw new AiError('Temporary', 503);
    return reply('Kết quả: ' + prompt);
  });
  const job = converter.create(input);
  await wait(() => converter.get(job.id).status === 'failed');
  assert.equal(max, 1); assert.equal(calls.length, 4);
  assert.equal(converter.get(job.id).completed, 2); assert.equal(converter.get(job.id).failed, 1);
  const original = converter.get(job.id).scripts[0].result;
  fail = false; converter.resume({ id: job.id, model: 'ag/other', keyId: 'key-id' });
  await wait(() => converter.get(job.id).status === 'completed');
  assert.equal(calls.length, 5); assert.equal(calls.at(-1).body.model, 'ag/other');
  assert.equal(converter.get(job.id).scripts[0].result, original);
  const snapshot = converter.snapshot(); assert.equal('scripts' in snapshot.jobs[0], false); assert.equal('prompt' in snapshot.jobs[0], false);
});

test('pause aborts in-flight generation, ignores late output and restores an interrupted checkpoint without automatic calls', async t => {
  let release;
  const { converter, input, directory, calls, gateway } = setup(t, async (_id, _body, _signal, count) => {
    if (count === 1) return reply('Đã xong đầu tiên');
    return new Promise(resolve => { release = () => resolve(reply('Kết quả đến muộn')); });
  });
  const job = converter.create(input);
  await wait(() => calls.length === 2);
  converter.pause(job.id); assert.equal(calls[1].signal.aborted, true);
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(converter.get(job.id).completed, 1); assert.equal(converter.get(job.id).scripts[1].result, undefined);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, job.id + '.json')));
  saved.status = 'running'; saved.scripts[1].status = 'processing';
  fs.writeFileSync(path.join(directory, job.id + '.json'), JSON.stringify(saved));
  const restored = new ScriptConverter(directory, () => gateway, 5);
  assert.equal(restored.get(job.id).status, 'paused'); assert.equal(restored.get(job.id).scripts[1].status, 'pending');
  assert.equal(restored.get(job.id).completed, 1); assert.equal(calls.length, 2);
  restored.shutdown();
});

test('429 cooldown is shared across the batch and abortable; authentication failures pause the remaining queue', async t => {
  const { converter, input, calls, gateway } = setup(t, async () => { throw new AiError('Quota', 429, 'rate_limit_error', '120'); });
  const job = converter.create(input);
  await wait(() => Boolean(converter.get(job.id).retryAt));
  assert.ok(Date.parse(converter.get(job.id).retryAt) - Date.now() > 115000);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.length, 1);
  converter.pause(job.id); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(converter.get(job.id).status, 'paused');
  gateway.desktopChat = async () => { throw new AiError('Key đã thu hồi', 401); };
  converter.resume({ id: job.id });
  await wait(() => converter.get(job.id).status === 'paused');
  assert.equal(converter.get(job.id).scripts[1].status, 'pending'); assert.equal(converter.get(job.id).completed, 0);
});

test('empty and truncated responses are never marked successful; configuration and one-active-job guards prevent accidental calls', async t => {
  const { converter, input, calls } = setup(t, async (_id, body) => body.messages[0].content.includes('Kịch bản 1') ? { choices: [{ finish_reason: 'length', message: { content: 'Incomplete' } }] } : reply(''));
  assert.throws(() => converter.create({ ...input, model: 'ag/image' }), /model văn bản/);
  assert.throws(() => converter.create({ ...input, keyId: 'bad' }), /thu hồi/);
  assert.throws(() => converter.create({ ...input, prompt: 'bad' }), /\[SCRIPT\]/);
  const job = converter.create(input);
  assert.throws(() => converter.create(input), /đang chạy/);
  assert.throws(() => converter.delete(job.id), /Dừng/);
  await wait(() => converter.get(job.id).status === 'failed');
  assert.equal(converter.get(job.id).completed, 0); assert.equal(calls.length, 5);
});

test('TXT and Word preserve source metadata and unfinished content, escape model HTML and reject unsafe link protocols', () => {
  const scripts = parseScripts(raw(2)).map(s => ({ ...s, attempts: 1, status: 'completed', result: '**Đậm** *Nghiêng*\n[Link](https://example.com/a_b?x=1&y=2)\n<script>alert(1)</script> [x](javascript:alert)' }));
  scripts[1].status = 'failed'; scripts[1].result = 'Không được dùng';
  const txt = exportScriptsText(scripts); assert.match(txt, /Tiêu đề 1/); assert.match(txt, /Kịch bản 2/); assert.ok(!txt.includes('Không được dùng'));
  const doc = exportScriptsDoc(scripts);
  assert.match(doc, /<strong>Đậm<\/strong>/); assert.match(doc, /<em>Nghiêng<\/em>/);
  assert.match(doc, /href="https:\/\/example.com\/a_b\?x=1&amp;y=2"/);
  assert.match(doc, /&lt;script&gt;/); assert.ok(!doc.includes('<script>')); assert.ok(!doc.includes('href="javascript:'));
});

test('trusted routes support parse/create/export/delete while web origins are denied; deletion removes persisted content', async t => {
  const { converter, input, directory } = setup(t);
  const app = express(); app.use(express.json()); mountScriptConverterRoutes(app, () => converter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/internal/script-converter`;
  const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let response = await post(input, { Origin: 'https://evil.example' }); assert.equal(response.status, 403); await response.text(); assert.equal(converter.snapshot().jobs.length, 0);
  response = await post({ action: 'parse', rawText: raw(2) }); assert.equal((await response.json()).scripts.length, 2);
  response = await post(input); const job = await response.json(); assert.equal(response.status, 200);
  await wait(() => converter.get(job.id).status === 'completed');
  response = await post({ action: 'export', id: job.id, format: 'txt' }); const exported = await response.json(); assert.match(exported.content, /Đã đổi/);
  response = await post({ action: 'delete', id: job.id }); assert.equal((await response.json()).jobs.length, 0);
  assert.equal(fs.existsSync(path.join(directory, job.id + '.json')), false);
});

test('desktop uses the selected personal key and real gateway model adapter without storing or exposing a raw key', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-script-gateway-'));
  const aiDir = path.join(directory, 'ai');
  const store = new AiStore(aiDir);
  store.save({ account: { id: 'account', accessToken: 'ya29.fixture-only', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600000, email: 'test@example.com', projectId: 'test-project' },
    keys: [], models: [{ id: 'ag/test', name: 'Test', kind: 'chat' }], modelAliases: {}, modelsUpdatedAt: new Date().toISOString() });
  const calls = [];
  const gateway = new AiGateway(aiDir, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Kết quả qua Antigravity' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const key = gateway.createKey('Cá nhân').createdKey;
  assert.throws(() => gateway.authenticate(key.id), error => error.status === 401);
  const converter = new ScriptConverter(path.join(directory, 'scripts'), () => gateway);
  t.after(() => { converter.shutdown(); gateway.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  const job = converter.create({ rawText: raw(1), mode: 'batch', keyId: key.id, model: 'ag/test', prompt: 'Đổi [SCRIPT]' });
  await wait(() => converter.get(job.id).status === 'completed');
  assert.equal(converter.get(job.id).scripts[0].result, 'Kết quả qua Antigravity');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ya29.fixture-only');
  assert.ok(JSON.parse(calls[0].options.body).request.contents[0].parts[0].text.includes('Kịch bản 1'));
  assert.ok(!fs.readFileSync(path.join(directory, 'scripts', job.id + '.json'), 'utf8').includes(key.key));
  assert.ok(!JSON.stringify(converter.snapshot()).includes('ya29.fixture'));
  gateway.revokeKey(key.id); await assert.rejects(gateway.desktopChat(key.id, {}), error => error.status === 401);
});

test('processes and restores 1000 scripts with unique IDs and a compact history snapshot', async t => {
  const { converter, input, calls, directory, gateway } = setup(t);
  const job = converter.create({ ...input, rawText: raw(1000) });
  await wait(() => converter.get(job.id).status === 'completed');
  assert.equal(calls.length, 1000); assert.equal(converter.get(job.id).completed, 1000);
  assert.ok(JSON.stringify(converter.snapshot()).length < 1000);
  const restored = new ScriptConverter(directory, () => gateway);
  assert.equal(restored.get(job.id).scripts.length, 1000); assert.equal(restored.get(job.id).completed, 1000);
  restored.shutdown();
});
