import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

export default defineConfig({
    base: './',
    build: {
        lib: { entry: resolve(__dirname, 'src/index.ts'), name: 'VFSUI', formats: ['es', 'umd'],
            fileName: format => format === 'es' ? 'vfs-ui.js' : 'vfs-ui.umd.cjs' },
        cssCodeSplit: false,
        sourcemap: true,
        rollupOptions: {
            external: ['@itookit/vfs-core'],
            output: { globals: { '@itookit/vfs-core': 'ItookitVFSCore' },
                assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : asset.name ?? 'asset' },
        },
    },
    plugins: [dts({ entryRoot: 'src', outDir: 'dist', insertTypesEntry: true })],
});
