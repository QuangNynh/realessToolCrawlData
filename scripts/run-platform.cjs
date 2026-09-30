const { execFileSync } = require('child_process');

const command = process.argv[2];
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : null;
if (!['dist', 'release'].includes(command) || !platform) {
  console.error('Use npm run dist or npm run release on Windows or macOS.');
  process.exit(1);
}
if (command === 'release' && !process.env.GH_TOKEN) {
  console.error('Set GH_TOKEN to publish locally, or push a version tag to use GitHub Actions.');
  process.exit(1);
}
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', `${command}:${platform}`], { stdio: 'inherit' });
