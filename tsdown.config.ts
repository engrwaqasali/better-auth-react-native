import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: { build: true, incremental: true },
  format: ['esm'],
  entry: ['./src/index.ts', './src/client.ts', './src/plugins/index.ts'],
  deps: {
    neverBundle: [
      'better-call',
      '@better-fetch/fetch',
      'react-native',
      '@react-native-community/netinfo',
      'react-native-inappbrowser-reborn',
    ],
  },
  platform: 'neutral',
  treeshake: true,
});
