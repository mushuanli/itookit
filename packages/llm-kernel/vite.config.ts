// @file: llm-kernel/vite.config.ts

import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        // 可选的子入口
        // 'cli/index': resolve(__dirname, 'src/cli/index.ts'),
        // 'worker/index': resolve(__dirname, 'src/worker/index.ts')
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'js' : 'cjs';
        return `${entryName}.${ext}`;
      }
    },
    rollupOptions: {
      external: [
        '@itookit/llm-driver',
        '@itookit/common',
        /^node:/
      ],
      output: {
        preserveModules: false,
        exports: 'named'
      }
    },
    sourcemap: true,
    minify: false,
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
