const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packages = [
  { name: '@ffmpeg-installer/win32-x64', binary: 'ffmpeg.exe' },
  { name: '@img/sharp-win32-x64', binary: 'lib/sharp-win32-x64.node' },
];
const lock = require(path.join(root, 'package-lock.json'));
const cache = path.join(root, 'build', 'native-cache');

function verify(file, integrity) {
  const [algorithm, expected] = integrity.split('-', 2);
  const actual = crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('base64');
  return actual === expected;
}

function prepare({ name, binary }) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry?.resolved || !entry?.integrity) throw new Error(`Missing locked package: ${name}`);
  const archive = path.join(cache, `${name.replace('/', '-')}-${entry.version}.tgz`);
  if (!fs.existsSync(archive) || !verify(archive, entry.integrity)) {
    const download = `${archive}.${process.pid}.download`;
    try {
      execFileSync('curl', ['-fL', '--retry', '3', '--connect-timeout', '15', '--output', download, entry.resolved], { stdio: 'inherit' });
      if (!verify(download, entry.integrity)) throw new Error(`Checksum mismatch: ${name}`);
      fs.renameSync(download, archive);
    } finally {
      if (fs.existsSync(download)) fs.unlinkSync(download);
    }
  }

  const destination = path.join(root, 'node_modules', name);
  const marker = path.join(destination, '.package-integrity');
  if (fs.existsSync(marker) && fs.existsSync(path.join(destination, binary)) && fs.readFileSync(marker, 'utf8') === entry.integrity) return;

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.lenyt-native-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temporary, '--strip-components', '1'], { stdio: 'inherit' });
    const metadata = JSON.parse(fs.readFileSync(path.join(temporary, 'package.json'), 'utf8'));
    if (metadata.name !== name || metadata.version !== entry.version) throw new Error(`Package metadata mismatch: ${name}`);
    if (!fs.existsSync(path.join(temporary, binary))) throw new Error(`Missing Windows binary: ${name}/${binary}`);
    fs.writeFileSync(path.join(temporary, '.package-integrity'), entry.integrity);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Prepared Windows native package: ${name}@${entry.version}`);
}

fs.mkdirSync(cache, { recursive: true });
for (const name of packages) prepare(name);
