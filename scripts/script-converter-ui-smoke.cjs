const { app, BrowserWindow, ipcMain, session, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AiStore } = require('../dist-backend/ai-store');
const { AiGateway } = require('../dist-backend/ai-gateway');
const { ScriptConverter } = require('../dist-backend/script-converter');
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-script-ui-'));
app.setPath('userData', path.join(artifactDir, 'profile'));
const raw = count => Array.from({ length: count }, (_, i) => `${i + 1}.\nhttps://youtube.com/watch?v=fixture${i}\n\nTiêu đề ${i + 1}\n\nKịch bản ${i + 1} tiếng Việt`).join('\n\n\n\n');

app.whenReady().then(async () => {
  const previousClipboard = clipboard.readText();
  const aiDir = path.join(artifactDir, 'ai');
  const store = new AiStore(aiDir);
  store.save({ keys: [], account: { id: 'fixture-account', email: 'fixture@example.com', projectId: 'fixture-project', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600000 },
    modelAliases: {}, modelsUpdatedAt: new Date().toISOString(), models: [{ id: 'ag/gemini-test', name: 'Gemini kiểm tra', kind: 'chat' }, { id: 'ag/claude-test', name: 'Claude kiểm tra', kind: 'chat' }, { id: 'ag/image-test', name: 'Ảnh', kind: 'image' }] });
  const calls = [], downloads = [];
  let blockSecond = true, thirdFailed = false;
  const gateway = new AiGateway(aiDir, async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.request.contents[0].parts[0].text;
    calls.push({ model: body.model, prompt, signal: options.signal });
    if (prompt.includes('Kịch bản 2') && blockSecond) {
      await new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); });
    }
    if (prompt.includes('Kịch bản 3') && !thirdFailed) {
      thirdFailed = true;
      return new Response(JSON.stringify({ error: { message: 'Temporary fixture failure' } }), { status: 503 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Kết quả: ' + prompt + '\n<script>window.fixtureXss = true</script> **đậm**' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  gateway.createKey('Key cá nhân');
  const converter = new ScriptConverter(path.join(artifactDir, 'scripts'), () => gateway, 20);
  ipcMain.handle('ai:request', (_event, request) => gateway.dispatch(request));
  ipcMain.handle('scripts:request', (_event, request) => converter.dispatch(request));
  ipcMain.handle('scripts:copy', (_event, text) => clipboard.writeText(text));
  ipcMain.handle('downloads:get-directory', () => null);
  ipcMain.handle('update:get-status', () => ({ state: 'idle', supported: false, currentVersion: '1.0.2' }));
  session.defaultSession.protocol.handle('http', () => new Response('', { status: 404 }));
  session.defaultSession.protocol.handle('https', () => new Response('', { status: 404 }));
  session.defaultSession.on('will-download', (_event, item) => {
    const file = path.join(artifactDir, item.getFilename()); item.setSavePath(file);
    item.once('done', (_event, state) => { assert.equal(state, 'completed'); downloads.push(file); });
  });
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../dist-electron/preload.js') } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Failed to load resource')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async predicate => { for (let i = 0; i < 160; i++) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out: ' + predicate); };
  const click = label => js(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) throw new Error('Missing or disabled: ' + ${JSON.stringify(label)}); button.click(); })()`);
  const input = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const screenshot = async name => { await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(path.join(artifactDir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const drop = (filename, text) => js(`(() => { const area = document.querySelector('textarea[aria-label="Nội dung kịch bản"]').parentElement; const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(filename)}, { type: 'text/plain' })); area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); })()`);
  try {
    await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/script-converter' });
    await wait(`document.querySelector('#script-key')?.options.length === 1 && document.querySelector('#script-model')?.options.length === 2`);
    await drop('wrong.csv', raw(3)); await wait(`document.body.textContent.includes('Vui lòng chọn file .txt')`);
    await drop('kichban.TXT', raw(3)); await wait(`document.querySelector('textarea[aria-label="Nội dung kịch bản"]').value.includes('Kịch bản 3')`);
    await click('Phân tích kịch bản'); await wait(`document.querySelectorAll('article').length === 3`);
    await input('#script-prompt', 'Viết lại: [SCRIPT]');
    await click('Bắt đầu chạy AI'); await wait(`document.body.textContent.includes('Kịch bản 2') && !document.querySelector('button[disabled]')?.textContent.includes('Dừng chạy')`);
    for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 2);
    // Navigation leaves the backend queue intact.
    await js(`document.querySelector('button[aria-label="AI / Antigravity"]').click()`);
    await wait(`!!document.querySelector('#ai-test-key')`);
    assert.equal(converter.snapshot().jobs[0].status, 'running');
    await js(`document.querySelector('button[aria-label="AI Script Converter"]').click()`);
    await wait(`document.body.textContent.includes('Dừng chạy')`);
    await click('Dừng chạy'); await wait(`document.body.textContent.includes('Đã dừng')`);
    assert.equal(calls[1].signal.aborted, true); assert.equal(converter.snapshot().jobs[0].completed, 1);
    blockSecond = false;
    await js(`document.querySelector('#script-model').value = 'ag/claude-test'; document.querySelector('#script-model').dispatchEvent(new Event('change', { bubbles: true }))`);
    await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Tiếp tục' && !b.disabled)`);
    await click('Tiếp tục'); await wait(`document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '100'`);
    assert.equal(calls.length, 5); assert.equal(calls[2].model, 'claude-test');
    assert.equal(calls.filter(call => call.prompt.includes('Kịch bản 1')).length, 1);
    await click('Xem kết quả'); await wait(`!!document.querySelector('[role="dialog"]')`);
    assert.equal(await js(`window.fixtureXss === true`), false);
    assert.equal(await js(`document.querySelector('[role="dialog"] pre').textContent.includes('<script>')`), true);
    await click('Sao chép');
    for (let i = 0; i < 50 && !clipboard.readText().includes('Kết quả: Viết lại: Kịch bản 1'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(clipboard.readText(), /Kết quả: Viết lại: Kịch bản 1/);
    await click('Đóng');
    await click('Sao chép kết quả');
    for (let i = 0; i < 50 && !clipboard.readText().includes('Tiêu đề 3'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(clipboard.readText(), /Tiêu đề 3/);
    await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Xuất TXT' && !b.disabled)`);
    await click('Xuất TXT');
    await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Xuất Word' && !b.disabled)`);
    await click('Xuất Word');
    for (let i = 0; i < 100 && downloads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(downloads.length, 2);
    const txt = fs.readFileSync(downloads.find(file => file.endsWith('.txt')), 'utf8');
    const doc = fs.readFileSync(downloads.find(file => file.endsWith('.doc')), 'utf8');
    assert.match(txt, /Kịch bản 3/); assert.match(doc, /&lt;script&gt;/); assert.ok(!doc.includes('<script>'));
    await new Promise(resolve => setTimeout(resolve, 4500));
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
      for (const width of [375, 768, 1280]) {
        win.setSize(width, 1000); await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await js(`document.documentElement.scrollWidth > window.innerWidth`), false, `Overflow: ${width}, ${theme}`);
        await js(`document.querySelector('main').scrollTop = 0`); await screenshot(`script-${width}-${theme}`);
        await js(`document.querySelector('[role="progressbar"]').closest('section').scrollIntoView({ block: 'start' })`); await screenshot(`script-results-${width}-${theme}`);
      }
    }
    await click('Xóa đợt đã lưu'); await wait(`!!document.querySelector('[role="dialog"]')`); await click('Xóa dữ liệu đợt này');
    await wait(`document.querySelector('#script-history').options.length === 1`);
    assert.equal(fs.readdirSync(path.join(artifactDir, 'scripts')).length, 0);
    await drop('batch.txt', raw(55)); await wait(`document.querySelector('textarea[aria-label="Nội dung kịch bản"]').value.includes('Kịch bản 55')`);
    await click('Phân tích kịch bản'); await wait(`document.querySelectorAll('article').length === 50`);
    await click('Trang sau'); await wait(`document.querySelectorAll('article').length === 5`);
    assert.equal(errors.length, 0, errors.join('\n'));
    converter.shutdown(); gateway.shutdown(); clipboard.writeText(previousClipboard);
    console.log('PASS: real backend converter + gateway adapter, TXT import, prompt/model/key, navigation, abort/resume/retry, safe preview, clipboard, TXT/Word downloads, deletion, pagination and responsive light/dark.');
    console.log('Artifacts:', artifactDir); app.exit(0);
  } catch (error) { console.error(error); await screenshot('failure'); console.log('Artifacts:', artifactDir); converter.shutdown(); gateway.shutdown(); clipboard.writeText(previousClipboard); app.exit(1); }
});
