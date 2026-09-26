import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'VFSUI',
    fileName: 'vfs-ui',
    rootDir: __dirname,
    external: ['@itookit/common', '@itookit/vfs-core', '@itookit/ui-common', 'immer'],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/ui-common': 'ItookitUICommon',
      immer: 'immer',
      '@itookit/vfs-core': 'ItookitStdio',
    }
  })
);
