import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dbchbin.ompgui.remote',
  appName: 'ompgui Remote',
  webDir: 'mobile-shell',
  server: {
    androidScheme: 'https',
    hostname: 'localhost'
  }
};

export default config;
