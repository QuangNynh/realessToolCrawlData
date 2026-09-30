const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');

const version = '2026.08.19';
const binaries = {
  mac: {
    asset: 'yt-dlp_macos.zip',
    source: 'yt-dlp_macos',
    filename: 'yt-dlp',
    sha256: '07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8',
  },
  win: {
    asset: 'yt-dlp_win.zip',
    source: 'yt-dlp.exe',
    filename: 'yt-dlp.exe',
    sha256: '30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf',
  },
};

const platform = process.argv[2] || (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : '');
const binary = binaries[platform];
if (!binary) throw new Error(`No standalone yt-dlp binary configured for ${platform || process.platform}`);

const base = path.join(__dirname, '..', 'build', 'yt-dlp');
const archive = path.join(base, `${platform}.zip`);
const directory = path.join(base, platform);
const marker = path.join(directory, '.sha256');
const checksum = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(archive) || checksum(archive) !== binary.sha256) {
    const temporary = `${archive}.${process.pid}.download`;
    try {
      execFileSync('curl', [
        '-fL', '--retry', '3', '--connect-timeout', '15', '--output', temporary,
        `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${binary.asset}`,
      ], { stdio: 'inherit' });
      if (checksum(temporary) !== binary.sha256) throw new Error(`yt-dlp checksum mismatch: ${binary.asset}`);
      fs.renameSync(temporary, archive);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== binary.sha256 || !fs.existsSync(path.join(directory, binary.filename))) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lenyt-yt-dlp-'));
    try {
      const zip = await JSZip.loadAsync(fs.readFileSync(archive));
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const parts = entry.name.split('/');
        if (parts.some(part => part === '..' || part === '') || path.isAbsolute(entry.name)) throw new Error(`Unsafe ZIP entry: ${entry.name}`);
        const target = path.join(temporary, entry.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await entry.async('nodebuffer'));
      }
      fs.renameSync(path.join(temporary, binary.source), path.join(temporary, binary.filename));
      if (platform === 'mac') fs.chmodSync(path.join(temporary, binary.filename), 0o755);
      fs.writeFileSync(path.join(temporary, '.sha256'), binary.sha256);
      fs.rmSync(directory, { recursive: true, force: true });
      fs.renameSync(temporary, directory);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  console.log(`Using verified unpacked yt-dlp ${version}: ${path.join(directory, binary.filename)}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
