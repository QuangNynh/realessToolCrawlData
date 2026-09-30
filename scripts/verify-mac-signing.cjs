const required = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing macOS signing/notarization credentials: ${missing.join(', ')}`);
  process.exit(1);
}
