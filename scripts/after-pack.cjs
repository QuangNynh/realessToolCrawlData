const { verifyWindowsBundle } = require('./verify-windows-bundle.cjs');
module.exports = async context => {
  if (context.electronPlatformName === 'win32') verifyWindowsBundle(context.appOutDir);
};
