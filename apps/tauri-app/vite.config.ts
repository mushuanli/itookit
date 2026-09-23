import { defineConfig } from 'vite';
import path from 'path';

const MERMAID_RUNTIME_PACKAGES = [
    '/mermaid/', '/@mermaid-js/', '/cytoscape', '/cose-base/', '/layout-base/',
    '/d3', '/dagre-d3-es/', '/graphlib/', '/katex/', '/khroma/', '/roughjs/',
    '/path-data-parser/', '/points-on-', '/stylis/', '/ts-dedent/',
    '/@braintree/sanitize-url/', '/@iconify/', '/dayjs/',
];

function dependencyChunk(id: string): string | undefined {
    if (!id.includes('node_modules')) return;
    const normalized = id.replaceAll('\\', '/');
    return MERMAID_RUNTIME_PACKAGES.some(name => normalized.includes(`/node_modules${name}`))
        ? 'mermaid-runtime' : 'vendor';
}

export default defineConfig({
    base: './',
    plugins: [{
        name: 'trace-tauri-relative-core',
        enforce: 'pre',
        transform(code, id) {
            if (!id.replaceAll('\\', '/').endsWith('/@tauri-apps/api/core.js')) return;
            const entry = 'return window.__TAURI_INTERNALS__.invoke(cmd, args, options);';
            if (code.split(entry).length !== 2) throw new Error('Tauri core invoke changed; update IPC instrumentation');
            const counter = JSON.stringify(path.resolve(__dirname, 'src/log/ipc-counter-state.ts'));
            return { code: `import { ipcCounter as __mindosIpc } from ${counter};\n` + code.replace(entry,
                `if (import.meta.env.VITE_MINDOS_TRACE === '1') __mindosIpc.record(cmd);\n    ${entry}`), map: null };
        },
        resolveId(source, importer) {
            if (source === './core.js' && importer?.replaceAll('\\', '/').includes('/@tauri-apps/api/')) {
                return path.resolve(__dirname, 'src/log/traced-core.ts');
            }
        },
    }],

    resolve: {
        alias: {
            '@tauri-apps/api/core': path.resolve(__dirname, 'src/log/traced-core.ts'),
            // CSS virtual modules
            '@itookit/vfs-ui/style.css':         path.resolve(__dirname, '../../packages/vfs-ui/src/styles/index.css'),
            '@itookit/mdxeditor/style.css':      path.resolve(__dirname, '../../packages/mdx/src/styles/index.css'),
            '@itookit/llm-ui/style.css':         path.resolve(__dirname, '../../packages/llm-ui/src/styles/index.css'),
            '@itookit/app-settings/style.css':   path.resolve(__dirname, '../../packages/app-settings/src/styles/styles.css'),
            // Package source aliases (dev-mode hot reload)
            '@itookit/common':         path.resolve(__dirname, '../../packages/common/src/index.ts'),
            '@itookit/mdxeditor':      path.resolve(__dirname, '../../packages/mdx/src/index.ts'),
            '@itookit/vfs-ui':         path.resolve(__dirname, '../../packages/vfs-ui/src/index.ts'),
            '@itookit/device-llm':     path.resolve(__dirname, '../../packages/device-llm/src/index.ts'),
            '@itookit/llm-session': path.resolve(__dirname, '../../packages/llm-session/src/index.ts'),
            '@itookit/llm-ui':         path.resolve(__dirname, '../../packages/llm-ui/src/index.ts'),
            '@itookit/app-settings':   path.resolve(__dirname, '../../packages/app-settings/src/index.ts'),
            '@itookit/vfs-core':          path.resolve(__dirname, '../../packages/vfs-core/src/index.ts'),
        },
    },

    server: {
        port:       1420,
        strictPort: true,
    },

    build: {
        // Keep fonts as same-origin files accepted by the desktop font-src policy.
        assetsInlineLimit: 0,
        target:    'es2021',
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
        rollupOptions: {
            // Mark ALL node:* built-ins as external.
            // NodeFsOps and BetterSqliteSidecarDb are only loaded via dynamic import
            // in defaultCreateFs/defaultCreateDb. Since the Tauri app ALWAYS provides
            // createFs and createDb, those dynamic chunks are never fetched at runtime.
            external: (id: string) =>
                id.startsWith('node:') ||
                id === 'better-sqlite3' ||
                id === 'child_process' ||
                id === 'readline',
            output: {
                // Keep the large diagram engine outside the startup vendor chunk. It is fetched
                // only when rendered Markdown actually contains a Mermaid block.
                manualChunks: dependencyChunk,
            },
        },
    },

    optimizeDeps: {
        exclude: ['better-sqlite3'],
    },
});
