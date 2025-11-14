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
      await build({
        entryPoints: ['src/styles/index.css'],
        bundle: true,
        outfile: 'dist/style.css',
        loader: { '.css': 'css' },
        minify: false,
      });
      
      console.log('✅ CSS bundled into dist/style.css');
    } catch (error) {
      console.error('❌ Error building CSS:', error);
    }
  }
})
