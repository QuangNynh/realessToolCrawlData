// Dependency installation must not query the anonymous GitHub Releases API.
// Reuse the same pinned and checksum-verified runtime used by packaged builds.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : null;
if (!platform) {
  console.log('Automatic desktop yt-dlp setup supports macOS and Windows only.');
  process.exit(0);
}
const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'prepare-yt-dlp.cjs'), platform], { stdio: 'inherit' });
const source = path.join(root, 'build', 'yt-dlp', platform);
const destination = path.join(path.dirname(require.resolve('youtube-dl-exec/package.json')), 'bin');
// Standalone yt-dlp requires its _internal directory alongside the executable.
// Copy the entire runtime; do not copy just the launcher.
fs.cpSync(source, destination, { recursive: true, force: true });
const executable = path.join(destination, platform === 'win' ? 'yt-dlp.exe' : 'yt-dlp');
if (platform === 'mac') fs.chmodSync(executable, 0o755);
execFileSync(executable, ['--version'], { stdio: 'inherit', timeout: 30_000 });
console.log('yt-dlp dependency runtime ready.');
