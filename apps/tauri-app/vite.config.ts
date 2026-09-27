import { defineConfig } from 'vite';
import path from 'path';
import { workspaceAliases, workspaceExcludes } from '../../scripts/workspace-sources.mjs';

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
        alias: [
            { find: '@tauri-apps/api/core', replacement: path.resolve(__dirname, 'src/log/traced-core.ts') },
            // Workspace packages resolve to source: one copy in the dev graph, HMR-friendly.
            // The list (and the CSS subpath entries) is shared with the web app so the two dev
            // graphs cannot drift apart again — see scripts/workspace-sources.mjs.
            ...workspaceAliases(__dirname),
        ],
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
        exclude: ['better-sqlite3', ...workspaceExcludes()],
    },
});
