import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    server: {
      deps: {
        external: [
          'react-native',
          '@react-native-community/netinfo',
          'react-native-inappbrowser-reborn',
        ],
      },
    },
  },
});
