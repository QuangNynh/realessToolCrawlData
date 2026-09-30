const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadSettings, registerDownloadHandler } = require('../dist-electron/download-settings');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-download-smoke-'));
app.setPath('userData', path.join(root, 'profile'));

app.whenReady().then(async () => {
  const folder = path.join(root, 'saved');
  fs.mkdirSync(folder);
  const settings = new DownloadSettings(app.getPath('userData'));
  let prompts = 0;
  registerDownloadHandler(session.defaultSession, settings, async () => { prompts++; settings.setDirectory(folder); return folder; });
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await win.loadURL('data:text/html,<body>Download smoke test</body>');
  const completed = [];
  session.defaultSession.on('will-download', (_event, item) => item.once('done', (_doneEvent, state) => completed.push(state)));
  try {
    for (let i = 0; i < 2; i++) {
      await win.webContents.executeJavaScript(`(() => { const blob = new Blob(['file-${i}'], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'sample.txt'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); })()`);
      for (let n = 0; n < 100 && completed.length <= i; n++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(completed[i], 'completed');
    }
    assert.equal(prompts, 1);
    assert.equal(fs.readFileSync(path.join(folder, 'sample.txt'), 'utf8'), 'file-0');
    assert.equal(fs.readFileSync(path.join(folder, 'sample (2).txt'), 'utf8'), 'file-1');
    assert.equal(new DownloadSettings(app.getPath('userData')).getDirectory(), folder);
    console.log('PASS: first download chooses a folder, later downloads reuse it, and duplicate names do not overwrite.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
