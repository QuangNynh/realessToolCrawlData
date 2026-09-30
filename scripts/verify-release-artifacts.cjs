const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version } = require('../package.json');

const platform = process.argv[2];
const names = platform === 'win'
  ? [`CrawlData-Setup-${version}.exe`]
  : platform === 'mac'
    ? [`CrawlData-${version}-arm64-mac.zip`, `CrawlData-${version}-arm64.dmg`]
    : null;
if (!names) throw new Error('Usage: node scripts/verify-release-artifacts.cjs win|mac');

const release = path.join(__dirname, '..', 'release');
const manifest = fs.readFileSync(path.join(release, platform === 'win' ? 'latest.yml' : 'latest-mac.yml'), 'utf8');
if (!manifest.includes(`version: ${version}\n`)) throw new Error('Update manifest version does not match package.json');

for (const name of names) {
  const file = path.join(release, name);
  if (!fs.existsSync(file) || !fs.existsSync(`${file}.blockmap`)) throw new Error(`Missing release file or blockmap: ${name}`);
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entry = manifest.match(new RegExp(`^  - url: ${escaped}\\n    sha512: ([^\\n]+)`, 'm'));
  if (!entry || entry[1] !== sha512) throw new Error(`Update manifest hash does not match: ${name}`);
  console.log(`Verified ${name} and update metadata`);
}
