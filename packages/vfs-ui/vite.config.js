import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  build: {
    // 开启 lib 模式，专门用于构建库
    lib: {
      // **关键**: 回归单一的 JS 入口文件
      entry: resolve(__dirname, 'src/index.js'),
      name: 'VFSui',
      formats: ['es', 'umd'],
      fileName: (format) => `vfs-ui.${format === 'es' ? 'js' : 'umd.cjs'}`
    },
    rollupOptions: {
      external: ['@itookit/vfs-core', '@itookit/common', 'immer'],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          'immer': 'immer',
          '@itookit/common': 'ItookitCommon',
          '@itookit/vfs-core': 'VFSCore',
        },
        // 确保CSS被提取为单独的文件
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'style.css';
          }
          return assetInfo.name;
        }
      }
    }
  },
  plugins: [
    {
      name: 'copy-types',
      closeBundle() {
        // 构建完成后复制类型定义文件
        try {
          mkdirSync('dist', { recursive: true });
          copyFileSync('src/index.d.ts', 'dist/index.d.ts');
          console.log('✓ Type definitions copied');
        } catch (err) {
          console.error('Failed to copy type definitions:', err);
        }
      }
    }
  ]
});
