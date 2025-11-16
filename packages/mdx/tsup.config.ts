// tsup.config.ts
import { defineConfig } from 'tsup'
import { buildSync } from 'esbuild'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  // @ts-ignore
  onSuccess: () => {
    try {
      buildSync({
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
