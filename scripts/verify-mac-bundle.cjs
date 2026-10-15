const fs = require('node:fs');
const path = require('node:path');
const { machOArchitectures, MACHO_ARM64 } = require('../dist-backend/native-architecture');

function verifyMacBundle(appOutDir) {
  let count = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile()) {
        const architectures = machOArchitectures(filename);
        if (!architectures) continue;
        if (!architectures.includes(MACHO_ARM64)) throw new Error(`macOS bundle contains a binary without arm64: ${filename}`);
        count++;
      }
    }
  }
  walk(appOutDir);
  if (!count) throw new Error('No native Mach-O binaries found in macOS bundle.');
  console.log(`Verified arm64 slices in ${count} macOS binaries, frameworks and native addons.`);
}
module.exports = { verifyMacBundle };
if (require.main === module) verifyMacBundle(process.argv[2]);
