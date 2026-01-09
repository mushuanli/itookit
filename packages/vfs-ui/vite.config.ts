import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'VFSUI',
    fileName: 'vfs-ui',
    rootDir: __dirname,
    external: ['@itookit/vfs', '@itookit/common', 'immer'],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs': 'VFSCore',
      'immer': 'immer'
    }
  })
);
