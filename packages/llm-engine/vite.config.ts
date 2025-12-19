// @file: llm-engine/vite.config.ts

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LLMEngine',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        '@itookit/llm-kernel',
        '@itookit/llm-driver',
        '@itookit/vfs-core'
      ],
      output: {
        globals: {
          '@itookit/llm-kernel': 'LLMKernel',
          '@itookit/llm-driver': 'LLMDriver',
          '@itookit/vfs-core': 'VFSCore'
        }
      }
    },
    sourcemap: true,
    minify: false
  }
});
