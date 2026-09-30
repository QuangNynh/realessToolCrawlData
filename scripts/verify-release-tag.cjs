const { version } = require('../package.json');
const tag = process.env.GITHUB_REF_NAME;
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || tag !== `v${version}`) {
  console.error(`Release tag ${tag || '(missing)'} must match package.json version v${version}.`);
  process.exit(1);
}
console.log(`Building CrawlData ${tag}`);
