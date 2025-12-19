import { defineConfig, searchForWorkspaceRoot } from 'vite'; 
import path from 'path';

export default defineConfig({
    // ✅ 关键 1: 相对路径，确保在非根目录或通过简单 server 启动时能找到 assets
    base: './', 

    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            
            // ✅ 映射所有 workspace 包到源码
            '@itookit/vfs-ui/style.css': path.resolve(__dirname, '../../packages/vfs-ui/src/styles/vfs-ui.unified.css'),
            '@itookit/mdxeditor/style.css': path.resolve(__dirname, '../../packages/mdx/src/styles/index.css'),
            '@itookit/memory-manager/style.css': path.resolve(__dirname, '../../packages/memory-manager/src/styles/memory-manager.css'),
            '@itookit/llm-ui/style.css': path.resolve(__dirname, '../../packages/llm-ui/src/styles/index.css'),
            '@itookit/app-settings/style.css': path.resolve(__dirname, '../../packages/app-settings/src/styles/styles.css'),
            '@itookit/common/style.css': path.resolve(__dirname, '../../packages/common/src/styles/index.css'),

            '@itookit/common': path.resolve(__dirname, '../../packages/common/src/index.ts'),
            '@itookit/vfs-core': path.resolve(__dirname, '../../packages/vfs-core/src/index.ts'),
            '@itookit/mdxeditor': path.resolve(__dirname, '../../packages/mdx/src/index.ts'),
            '@itookit/vfs-ui': path.resolve(__dirname, '../../packages/vfs-ui/src/index.ts'),
            '@itookit/llm-driver': path.resolve(__dirname, '../../packages/llm-driver/src/index.ts'),
            '@itookit/llm-kernel': path.resolve(__dirname, '../../packages/llm-kernel/src/index.ts'),
            '@itookit/llm-engine': path.resolve(__dirname, '../../packages/llm-engine/src/index.ts'),
            '@itookit/llm-ui': path.resolve(__dirname, '../../packages/llm-ui/src/index.ts'),
            '@itookit/app-settings': path.resolve(__dirname, '../../packages/app-settings/src/index.ts'),
            '@itookit/memory-manager': path.resolve(__dirname, '../../packages/memory-manager/src/index.ts'),
        },
        // ✅ 建议: 防止 React/Vue 等库在 Monorepo 中被打包两次 (双重实例问题)
        dedupe: ['react', 'react-dom', 'dexie', 'mermaid', '@codemirror/state', '@codemirror/view'] 
    },
    server: {
        port: 3000,
        open: true,
        // ✅ 关键 2: Monorepo 必须配置文件系统权限
        // 因为你的依赖代码在 ../../packages/ 目录下，超出了当前项目根目录
        fs: {
            allow: [
                // 自动搜索 workspace 根目录并允许访问
                searchForWorkspaceRoot(process.cwd()),
            ],
        },
    },
    build: {
        target: 'esnext',
        // 生产环境构建配置
        rollupOptions: {
            output: {
                // 可选：把所有 node_modules 依赖打成一个 vendor 包，减少碎片文件
                manualChunks: (id) => {
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                }
            }
        }
    },

    // 关于 optimizeDeps 的说明见下方解释
    optimizeDeps: {
        include: [
            // 如果这些包已经编译成了 JS (dist)，加在这里没问题。
            // 如果这些包 main 指向的是 .ts 源码，建议从这里移除，
            // 让 Vite 直接把它们当源码处理，这样热更新 (HMR) 会更快。
            // '@itookit/common', 
            // '@itookit/vfs-core',
            // ...
            
            // 建议保留第三方纯 JS 库的预构建
            'mermaid',
            'dexie',
            'marked'
        ]
    }
});