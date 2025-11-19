import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'MemoryManager',
            formats: ['es', 'umd'],
            fileName: (format) => `memory-manager.${format === 'es' ? 'js' : 'umd.cjs'}`
        },
        rollupOptions: {
            external: [
                '@itookit/common',
                '@itookit/vfs-core',
                '@itookit/vfs-ui',
                '@itookit/mdxeditor'
            ],
            output: {
                globals: {
                    '@itookit/common': 'ItookitCommon',
                    '@itookit/vfs-core': 'VFSCore',
                    '@itookit/vfs-ui': 'VFSUI',
                    '@itookit/mdxeditor': 'MDxEditor'
                },
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name && assetInfo.name.endsWith('.css')) {
                        return 'style.css';
                    }
                    return assetInfo.name || 'asset';
                }
            }
        },
        sourcemap: true,
        emptyOutDir: true,
    },
    plugins: [
        dts({
            entryRoot: 'src',
            outDir: 'dist',
            insertTypesEntry: true,
        })
    ]
});
