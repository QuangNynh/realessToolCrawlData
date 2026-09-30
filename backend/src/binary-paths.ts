// Electron can read files inside app.asar, but child processes cannot execute them there.
export function executablePath(binaryPath: string): string {
  return binaryPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
