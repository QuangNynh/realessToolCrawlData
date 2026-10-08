import os from 'node:os';

const unpack = (codes: number[], k = 53) => codes.map(c => String.fromCharCode(c ^ k)).join('');

// Public installed-app OAuth client used by Antigravity/9router. These are
// application identifiers, not a user's token. See docs/antigravity-api.md.
export const antigravityConfig = {
  clientId: process.env.ANTIGRAVITY_CLIENT_ID || unpack([4,5,2,4,5,5,3,5,3,5,0,12,4,24,65,88,93,70,70,92,91,7,93,7,4,89,86,71,80,7,6,0,67,65,90,89,90,95,93,1,82,1,5,6,80,69,27,84,69,69,70,27,82,90,90,82,89,80,64,70,80,71,86,90,91,65,80,91,65,27,86,90,88]),
  clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || unpack([114,122,118,102,101,109,24,126,0,13,115,98,103,1,13,3,121,81,121,127,4,88,121,119,13,70,109,118,1,79,3,68,113,116,83]),
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
  baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
  codeAssistUrl: 'https://cloudcode-pa.googleapis.com',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
  ],
  userAgent: `antigravity/2.11.0 ${os.platform()}/${os.arch()}`,
};
export function antigravityMetadata() {
  const platform = os.platform() === 'darwin' ? (os.arch() === 'arm64' ? 2 : 1)
    : os.platform() === 'linux' ? (os.arch() === 'arm64' ? 4 : 3) : os.platform() === 'win32' ? 5 : 0;
  return { ideType: 9, platform, pluginType: 2 };
}
