import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neuralevolution.operatives',
  appName: 'Neural Evolution: Operatives',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#050a09',
    allowMixedContent: false,
  },
};

export default config;
