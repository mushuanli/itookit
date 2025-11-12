// tsup.config.ts
import { defineConfig } from 'tsup'
import { build } from 'esbuild'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  onSuccess: async () => {
    try {
      // 使用 esbuild 构建 CSS
      await build({
        entryPoints: ['src/styles/index.css'],
        bundle: true,
        outfile: 'dist/style.css',
        loader: { '.css': 'css' },
        minify: false, // 设置为 true 可以压缩 CSS
      });
      
      console.log('✅ CSS bundled into dist/style.css');
    } catch (error) {
      console.error('❌ Error building CSS:', error);
    }
  }
})
