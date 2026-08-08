import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'VFSUI',
    fileName: 'vfs-ui',
    rootDir: __dirname,
    external: ['@itookit/common', '@itookit/stdio', 'immer'],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/stdio': 'ItookitStdio',
      'immer': 'immer'
    }
  })
);
