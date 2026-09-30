const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function createHarness({ packaged = true, check, download } = {}) {
  const updater = new EventEmitter();
  updater.checkForUpdates = check || (async () => {
    updater.emit('update-not-available');
    return { isUpdateAvailable: false };
  });
  updater.downloadUpdate = download || (async () => {
    updater.emit('download-progress', { percent: 72, transferred: 72, total: 100, bytesPerSecond: 24 });
    updater.emit('update-downloaded', { version: '1.0.2' });
  });
  updater.quitAndInstall = () => { updater.installed = true; };
  const handlers = new Map();
  const sent = [];
  const webContents = { send: (...args) => sent.push(args) };
  const window = { webContents, isDestroyed: () => false };
  const electron = { app: { isPackaged: packaged, getVersion: () => '1.0.1' } };
  const originalLoad = Module._load;
  const originalPlatform = process.platform;
  const target = path.resolve(__dirname, '../dist-electron/updater.js');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return electron;
      if (request === 'electron-updater') return { autoUpdater: updater };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[target];
    require(target).registerUpdaterIpc({ handle: (name, handler) => handlers.set(name, handler) }, () => window);
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    delete require.cache[target];
  }
  const invoke = (name) => handlers.get(name)({ sender: webContents });
  return { updater, sent, invoke };
}

test('updater checks only on request, downloads only after available, and installs only after download', async () => {
  let checks = 0;
  const harness = createHarness({ check: async () => {
    checks += 1;
    harness.updater.emit('update-available', { version: '1.0.2' });
    return { isUpdateAvailable: true };
  } });
  assert.equal(harness.updater.autoDownload, false);
  assert.equal(harness.updater.autoInstallOnAppQuit, false);
  assert.equal(checks, 0);
  await assert.rejects(harness.invoke('update:download'), /Check for an update/);
  assert.equal((await harness.invoke('update:check')).newVersion, '1.0.2');
  assert.equal(checks, 1);
  assert.equal((await harness.invoke('update:download')).state, 'downloaded');
  assert.ok(harness.sent.some(([event, value]) => event === 'update:progress' && value.progress?.percent === 72));
  harness.invoke('update:install');
  assert.equal(harness.updater.installed, true);
});

test('updater handles no release, network errors, and development mode without crashing', async () => {
  const noRelease = createHarness();
  assert.equal((await noRelease.invoke('update:check')).state, 'not-available');

  const offline = createHarness({ check: async () => { throw new Error('ENOTFOUND api.github.com'); } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await offline.invoke('update:check');
    assert.equal(result.state, 'error');
    assert.match(result.message, /Cannot reach GitHub/);
  } finally {
    console.error = originalError;
  }

  const development = createHarness({ packaged: false });
  assert.equal((await development.invoke('update:get-status')).supported, false);
  await assert.rejects(development.invoke('update:check'), /packaged/);
});

test('repeated Check and Download clicks share one operation', async () => {
  let finishCheck;
  let finishDownload;
  let checks = 0;
  let downloads = 0;
  const harness = createHarness({
    check: () => { checks += 1; return new Promise((resolve) => { finishCheck = () => {
      harness.updater.emit('update-available', { version: '1.0.2' });
      resolve({ isUpdateAvailable: true });
    }; }); },
    download: () => { downloads += 1; return new Promise((resolve) => { finishDownload = () => {
      harness.updater.emit('update-downloaded', { version: '1.0.2' });
      resolve([]);
    }; }); },
  });
  const checkA = harness.invoke('update:check');
  const checkB = harness.invoke('update:check');
  assert.equal(checks, 1);
  finishCheck();
  await Promise.all([checkA, checkB]);
  const downloadA = harness.invoke('update:download');
  const downloadB = harness.invoke('update:download');
  assert.equal(downloads, 1);
  finishDownload();
  assert.equal((await downloadA).state, 'downloaded');
  assert.equal((await downloadB).state, 'downloaded');
});
