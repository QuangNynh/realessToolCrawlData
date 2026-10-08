const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-ai-ui-'));
app.setPath('userData', path.join(artifactDir, 'profile'));

app.whenReady().then(async () => {
  const calls = [];
  const state = { connected: false, connecting: false, models: [], keys: [], baseUrl: 'http://127.0.0.1:8696/v1' };
  const key = 'sk-crawldata-ui-fixture-only';
  const models = [{ id: 'ag/gemini-test', name: 'Gemini kiểm tra', kind: 'chat' }, { id: 'ag/claude-test', name: 'Claude kiểm tra', kind: 'chat' }, { id: 'ag/gemini-image-test', name: 'Tạo ảnh kiểm tra', kind: 'image' }];
  const snapshot = () => structuredClone(state);
  ipcMain.handle('ai:request', (_event, request) => {
    calls.push(request);
    switch (request.action) {
      case 'connect': state.connecting = true; return snapshot();
      case 'cancel-connect': state.connecting = false; return snapshot();
      case 'disconnect': state.connected = false; delete state.email; state.models = []; return snapshot();
      case 'create-key':
        state.keys.push({ id: 'key-' + (state.keys.length + 1), name: request.name, preview: 'sk-crawldata-ui…only', createdAt: new Date().toISOString() });
        return { ...snapshot(), createdKey: { id: state.keys.at(-1).id, name: request.name, key } };
      case 'revoke-key': state.keys = state.keys.filter(item => item.id !== request.id); return snapshot();
      case 'refresh-models': state.models = models; return snapshot();
      case 'chat':
        if (request.apiKey !== key) throw new Error('API key không hợp lệ hoặc đã thu hồi');
        if (request.model.includes('image')) return { choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=' } }] } }] };
        return { choices: [{ message: { content: 'Phản hồi mẫu từ ' + request.model + ' <script>không chạy</script>' } }] };
      default: return snapshot();
    }
  });
  ipcMain.handle('downloads:get-directory', () => '/tmp/ui-downloads');
  ipcMain.handle('downloads:choose-directory', () => '/tmp/ui-downloads');
  ipcMain.handle('update:get-status', () => ({ state: 'idle', supported: false, currentVersion: '1.0.2' }));
  session.defaultSession.protocol.handle('http', () => new Response('', { status: 404 }));
  session.defaultSession.protocol.handle('https', () => new Response('', { status: 404 }));
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../dist-electron/preload.js') } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Failed to load resource')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async predicate => {
    for (let i = 0; i < 120; i++) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out: ' + predicate);
  };
  const click = label => js(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) throw new Error('Missing or disabled button: ' + ${JSON.stringify(label)}); button.click(); })()`);
  const input = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const screenshot = async name => { await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(path.join(artifactDir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/ai' });
    await wait(`!!document.querySelector('input[aria-label="Tên API key"]')`);
    await click('Kết nối Antigravity');
    await wait(`document.body.textContent.includes('Đang chờ đăng nhập Google')`);
    await click('Hủy đăng nhập');
    await wait(`document.body.textContent.includes('Chưa kết nối')`);
    await click('Kết nối Antigravity');
    state.connected = true; state.connecting = false; state.email = 'ui-test@example.com'; state.models = models;
    await wait(`document.body.textContent.includes('Đã kết nối: ui-test@example.com')`);
    await click('Tạo API key');
    await wait(`document.body.textContent.includes('Key mới — sao chép và lưu lại')`);
    assert.equal(await js(`document.querySelector('#ai-test-key').value`), key);
    await input('textarea[aria-label="Nội dung gọi model"]', 'Xin chào');
    await click('Gọi model');
    await wait(`document.body.textContent.includes('Phản hồi mẫu từ ag/gemini-test')`);
    assert.equal(await js(`document.querySelectorAll('script').length > 1`), false);
    await js(`document.querySelector('#ai-test-model').value = 'ag/claude-test'; document.querySelector('#ai-test-model').dispatchEvent(new Event('change', { bubbles: true }))`);
    await click('Gọi model');
    await wait(`document.body.textContent.includes('Phản hồi mẫu từ ag/claude-test')`);
    await js(`document.querySelector('#ai-test-model').value = 'ag/gemini-image-test'; document.querySelector('#ai-test-model').dispatchEvent(new Event('change', { bubbles: true }))`);
    await click('Gọi model');
    await wait(`!!document.querySelector('img[alt="Ảnh model tạo 1"]')`);
    const chatCalls = calls.filter(call => call.action === 'chat');
    assert.equal(new Set(chatCalls.map(call => call.apiKey)).size, 1);
    assert.equal(new Set(chatCalls.map(call => call.model)).size, 3);
    await input('#ai-test-key', 'invalid-key'); await click('Gọi model');
    await wait(`document.body.textContent.includes('API key không hợp lệ hoặc đã thu hồi')`);
    await input('input[aria-label="Tìm model"]', 'claude');
    assert.equal(await js(`document.querySelectorAll('button code').length`), 1);
    await input('input[aria-label="Tìm model"]', '');
    await js(`document.querySelector('#ai-test-model').value = 'ag/gemini-test'; document.querySelector('#ai-test-model').dispatchEvent(new Event('change', { bubbles: true }))`);
    state.modelAliases = { 'ag/gemini-test': 'ag/claude-test' };
    state.defaultModelId = 'ag/default-test';
    state.models = [...models.filter(item => item.id !== 'ag/gemini-test'), { id: 'ag/default-test', name: 'Model mặc định mới', kind: 'chat' }];
    await wait(`document.querySelector('#ai-test-model').value === 'ag/claude-test' && ![...document.querySelector('#ai-test-model').options].some(o => o.value === 'ag/gemini-test')`);
    await input('#ai-test-key', key); await click('Gọi model');
    await wait(`document.body.textContent.includes('Phản hồi mẫu từ ag/claude-test')`);
    assert.equal(calls.filter(call => call.action === 'chat').at(-1).model, 'ag/claude-test');
    await click('Ẩn key');
    assert.equal(await js(`document.body.textContent.includes(${JSON.stringify(key)})`), false);
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); document.documentElement.style.colorScheme = ${JSON.stringify(theme)}`);
      for (const width of [375, 768, 1280]) {
        win.setSize(width, 1000);
        await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        assert.equal(await js(`document.documentElement.scrollWidth > window.innerWidth`), false, `Overflow at ${width} ${theme}`);
        await js(`document.querySelector('main').scrollTop = 0`);
        await screenshot(`ai-${width}-${theme}`);
      }
    }
    await click('Thu hồi');
    await wait(`document.body.textContent.includes('Chưa có key.')`);
    await click('Ngắt kết nối');
    await wait(`document.body.textContent.includes('Chưa kết nối')`);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: AI login state, personal keys, all discovered models, chat, images, errors and responsive themes.');
    console.log('Screenshots:', artifactDir);
    app.exit(0);
  } catch (error) { console.error(error); await screenshot('failure'); console.log('Screenshots:', artifactDir); app.exit(1); }
});
