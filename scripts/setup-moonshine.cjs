const path = require('node:path');
const { MoonshineRuntime } = require('../dist-backend/moonshine-runtime');
const runtime = new MoonshineRuntime(path.join(__dirname, '../data/moonshine-runtime'));
process.once('SIGTERM', () => runtime.shutdown());
process.once('SIGINT', () => runtime.shutdown());
void (async () => {
  await runtime.refresh();
  if (!runtime.status().ready) runtime.install();
  let previous = '';
  while (runtime.status().installing) {
    const { message } = runtime.status();
    if (message !== previous) { console.log(message); previous = message; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!runtime.status().ready) throw new Error(runtime.status().message);
  console.log(runtime.status().message);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
