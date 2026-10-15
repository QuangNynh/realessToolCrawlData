const { verifyWindowsBundle } = require('./verify-windows-bundle.cjs');
const { verifyMacBundle } = require('./verify-mac-bundle.cjs');
module.exports = async context => {
  if (context.electronPlatformName === 'win32') verifyWindowsBundle(context.appOutDir);
  if (context.electronPlatformName === 'darwin') verifyMacBundle(context.appOutDir);
};
