const path = require('node:path');
const { WhisperRuntime } = require('../dist-backend/media-runtime');
const runtime = new WhisperRuntime(path.join(__dirname, '../data/media-runtime'));
void runtime.refresh().then(() => { if (runtime.status().ready) { console.log(runtime.status().message); clearInterval(timer); } else runtime.install(); });
let previous = '';
const timer = setInterval(() => {
  const state = runtime.status();
  if (previous !== state.message) { console.log(state.message); previous = state.message; }
  if (!state.checking && !state.installing && state.ready) clearInterval(timer);
  else if (!state.checking && !state.installing && state.message.startsWith('Cài Whisper thất bại')) { clearInterval(timer); process.exitCode = 1; }
}, 1000);
process.once('SIGTERM', () => runtime.shutdown());
process.once('SIGINT', () => runtime.shutdown());
