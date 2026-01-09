import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    '@itookit/common',
    '@itookit/llm-driver',
    '@itookit/llm-kernel',
    '@itookit/vfs'
  ]
});
