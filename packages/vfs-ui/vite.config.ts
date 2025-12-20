import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'VFSUI',
    fileName: 'vfs-ui',
    rootDir: __dirname,
    external: ['@itookit/vfs-core', '@itookit/common', 'immer'],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs-core': 'VFSCore',
      'immer': 'immer'
    }
  })
);
