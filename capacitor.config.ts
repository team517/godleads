import type { CapacitorConfig } from '@capacitor/cli';

// The `server.url` block that used to live here pointed the native shell at the
// Lovable preview host; the app now ships the built `dist/` assets.
const config: CapacitorConfig = {
  appId: 'online.onepulso.app',
  appName: 'OnePulso',
  webDir: 'dist'
};

export default config;
