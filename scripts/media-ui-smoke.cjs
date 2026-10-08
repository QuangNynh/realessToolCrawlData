const { app, BrowserWindow, ipcMain, session, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { MediaJobs } = require('../dist-backend/media-jobs');
const { createMediaProcessor } = require('../dist-backend/media-processor');
const { runMediaProcess, mediaFfmpeg } = require('../dist-backend/media-runtime');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawldata-media-ui-'));
app.setPath('userData', path.join(dir, 'profile'));
app.whenReady().then(async () => {
  const previousClipboard = clipboard.readText();
  const out = path.join(dir, 'outputs'); fs.mkdirSync(out);
  const oneDir = path.join(dir, 'one'), twoDir = path.join(dir, 'two'); fs.mkdirSync(oneDir); fs.mkdirSync(twoDir);
  const audio = [path.join(oneDir, 'giọng nói tiếng Việt.wav'), path.join(twoDir, 'giọng nói tiếng Việt.wav')];
  audio.forEach(filename => fs.writeFileSync(filename, 'fixture audio'));
  const video = path.join(dir, 'video demo.mp4');
  await runMediaProcess(mediaFfmpeg, ['-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', video], new AbortController().signal);
  let ready = false, block = true, calls = 0, batch = 0;
  const runtime = { status: () => ({ ready, checking: false, installing: false, message: ready ? 'Whisper sẵn sàng · fixture' : 'Whisper hiện có không chạy được. Bấm Cài / sửa Whisper.' }), refresh: async () => {}, install: () => { ready = true; return runtime.status(); }, shutdown() {} };
  const realProcessor = createMediaProcessor(runtime), outputs = [], downloads = [];
  const media = new MediaJobs(path.join(dir, 'state'), runtime, async (input, job, item, signal, update) => {
    if (job.tool === 'extract') return realProcessor(input, job, item, signal, update);
    calls++; update('Whisper đang nhận dạng', 30);
    if (calls === 2 && block) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    const filename = path.join(dir, item.id + '.tmp');
    fs.writeFileSync(filename, job.tool === 'srt' ? '1\n00:00:00,000 --> 00:00:02,000\nXin chào <script>window.fixtureXss=true</script>\n' : 'Xin chào. Đây là lời nói tiếng Việt.');
    return { path: filename, extension: job.tool === 'srt' ? 'srt' : 'txt', cleanup: () => fs.rmSync(filename, { force: true }) };
  });
  const selected = new Map();
  const register = paths => paths.map((filename, i) => { const id = `${batch}-${i}`; selected.set(id, filename); return { id, name: path.basename(filename), bytes: fs.statSync(filename).size }; });
  ipcMain.handle('media:select', (_event, tool) => { batch++; return register(tool === 'extract' ? [video] : audio); });
  ipcMain.handle('media:files', (_event, paths) => { if (paths.some(item => !item)) throw new Error('Chỉ chấp nhận file trên máy'); batch++; return register(paths); });
  ipcMain.handle('media:request', async (_event, request) => {
    if (request.action === 'create') return media.add({ tool: request.tool, paths: request.fileIds.map(id => selected.get(id)), directory: out, options: request.options });
    if (request.action === 'reveal') { outputs.push(media.output(request.id, request.itemId)); return { success: true }; }
    return media.dispatch(request);
  });
  ipcMain.handle('scripts:copy', (_event, text) => clipboard.writeText(text));
  ipcMain.handle('downloads:get-directory', () => out); ipcMain.handle('downloads:choose-directory', () => out);
  session.defaultSession.on('will-download', (_event, item) => {
    const filename = path.join(dir, 'download-' + item.getFilename()); item.setSavePath(filename);
    item.once('done', (_event, state) => { assert.equal(state, 'completed'); downloads.push(filename); });
  });
  const win = new BrowserWindow({ show: false, width: 1360, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../dist-electron/preload.js') } });
  const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Failed to load resource')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async predicate => { for (let i = 0; i < 180; i++) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out: ' + predicate); };
  const click = label => js(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b||b.disabled)throw new Error('Missing/disabled: '+${JSON.stringify(label)}); b.click(); })()`);
  const navigate = label => js(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  const choose = () => js(`document.querySelector('[data-media-tool] button.border-dashed').click()`);
  const screenshot = async name => fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/audio-to-srt' });
    await wait(`document.body.textContent.includes('Cài / sửa Whisper')`);
    await choose(); await wait(`document.querySelectorAll('article').length===2`);
    assert.equal(await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Chuyển sang SRT').disabled`), true);
    await click('Cài / sửa Whisper'); await wait(`document.body.textContent.includes('Whisper sẵn sàng')`);
    await js(`document.querySelector('#media-language').value='vi';document.querySelector('#media-language').dispatchEvent(new Event('change',{bubbles:true}))`);
    await click('Chuyển sang SRT'); await wait(`document.body.textContent.includes('Đang xử lý')`);
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 2); assert.equal(media.snapshot().jobs[0].options.language, 'vi');
    await navigate('Extract Audio'); await wait(`!!document.querySelector('#media-format')`);
    assert.equal(media.snapshot().jobs[0].items[1].status, 'running');
    await navigate('Convert Audio to SRT'); await wait(`document.body.textContent.includes('Tạm dừng')`);
    await click('Tạm dừng'); await wait(`document.body.textContent.includes('Đã tạm dừng')`);
    block = false; await click('Tiếp tục'); await wait(`document.body.textContent.includes('2/2 đã lưu')`);
    const srtJob = media.snapshot().jobs[0]; assert.notEqual(srtJob.items[0].output, srtJob.items[1].output);
    await click('Xem kết quả'); await wait(`!!document.querySelector('[role="dialog"] pre')`);
    assert.equal(await js(`window.fixtureXss===true`), false);
    await click('Sao chép'); await wait(`document.body.textContent.includes('Đã sao chép')`); assert.match(clipboard.readText(), /00:00:00,000/);
    await click('Tải kết quả'); await click('Đóng');
    await click('Mở thư mục'); assert.ok(outputs.length);
    await click('Xuất ZIP'); await wait(`document.body.textContent.includes('Đã lưu ZIP')`); assert.ok(fs.readdirSync(out).some(name => name.endsWith('.zip')));
    await navigate('Audio to Script'); await wait(`!!document.querySelector('#media-model')`);
    await choose(); await wait(`document.querySelectorAll('article').length===2`); await click('Chuyển sang Script'); await wait(`document.body.textContent.includes('2/2 đã lưu')`);
    await click('Sao chép tất cả'); await wait(`document.body.textContent.includes('Đã sao chép')`);
    for (let i = 0; i < 100 && !clipboard.readText().includes('2. giọng nói'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(clipboard.readText(), /2\. giọng nói/);
    await click('Xuất TXT gộp');
    for (let i = 0; i < 100 && downloads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(downloads.length, 2); assert.match(fs.readFileSync(downloads.find(file => file.endsWith('audio-to-script.txt')), 'utf8'), /^1\. giọng nói/);
    await click('Xóa lịch sử xử lý'); await wait(`!!document.querySelector('[role="dialog"]')`); await click('Xóa lịch sử');
    await wait(`document.querySelector('select[aria-label="Đợt xử lý audio"]').options.length===1`);
    assert.ok(fs.readdirSync(out).filter(name => name.endsWith('.txt')).length===2);
    await navigate('Extract Audio'); await wait(`!!document.querySelector('#media-format')`);
    await js(`document.querySelector('#media-format').value='flac';document.querySelector('#media-format').dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('#media-bitrate').disabled`); await choose(); await wait(`document.querySelectorAll('article').length===1`);
    await click('Tách audio'); await wait(`document.body.textContent.includes('1/1 đã lưu')`);
    const extracted = media.snapshot().jobs.find(job => job.tool === 'extract').items[0].output; assert.ok(extracted.endsWith('.flac'));
    await runMediaProcess(mediaFfmpeg, ['-nostdin', '-v', 'error', '-i', extracted, '-f', 'null', '-'], new AbortController().signal);
    for (const [label, route] of [['Convert Audio to SRT', 'srt'], ['Audio to Script', 'script'], ['Extract Audio', 'extract']]) {
      await navigate(label); await wait(`!!document.querySelector('[data-media-tool="${route}"]')`);
      for (const [width, theme] of [[480, 'light'], [800, 'dark'], [1360, 'light']]) {
        win.setSize(width, 900); await js(`document.documentElement.classList.toggle('dark',${theme === 'dark'}); document.querySelector('main').scrollTop=0`);
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal(await js(`document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth`), false, `${route}, ${width} overflow`);
        await screenshot(`${route}-${width}-${theme}`);
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    media.shutdown(); clipboard.writeText(previousClipboard);
    console.log('PASS: three pages, runtime install/error state, duplicate names, navigation, pause/resume, safe SRT preview, copy, TXT/ZIP exports, history cleanup, real FFmpeg extraction and responsive layouts.'); console.log('Artifacts:', dir); app.exit(0);
  } catch (error) { console.error(error); await screenshot('failure'); console.log('Artifacts:', dir); media.shutdown(); clipboard.writeText(previousClipboard); app.exit(1); }
});
