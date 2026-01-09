import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'MemoryManager',
    fileName: 'memory-manager',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/vfs',
      '@itookit/vfs-ui',
      '@itookit/mdxeditor',
      'immer'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs': 'VFSCore',
      '@itookit/vfs-ui': 'VFSUI',
      '@itookit/mdxeditor': 'MDxEditor',
      'immer': 'immer'
    }
  })
);
