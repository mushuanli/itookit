import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),

      // ========== CSS 别名 ==========
      '@itookit/common/style.css': path.resolve(__dirname, '../../packages/common/src/styles/index.css'),
      '@itookit/vfs-ui/style.css': path.resolve(__dirname, '../../packages/vfs-ui/src/styles/index.css'),
      '@itookit/mdxeditor/style.css': path.resolve(__dirname, '../../packages/mdx/src/styles/index.css'),
      '@itookit/memory-manager/style.css': path.resolve(__dirname, '../../packages/memory-manager/src/styles/memory-manager.css'),
      '@itookit/llm-ui/style.css': path.resolve(__dirname, '../../packages/llm-ui/src/styles/index.css'),
      '@itookit/app-settings/style.css': path.resolve(__dirname, '../../packages/app-settings/src/styles/styles.css'),

      // ========== 包别名（指向源码）==========
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
    dedupe: ['react', 'react-dom', 'dexie', 'mermaid', '@codemirror/state', '@codemirror/view']
  },

  server: {
    port: 3000,
    open: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  },

  optimizeDeps: {
    // 排除 workspace 包，让 Vite 直接处理源码
    exclude: [
      '@itookit/common',
      '@itookit/vfs-core',
      '@itookit/mdxeditor',
      '@itookit/vfs-ui',
      '@itookit/llm-driver',
      '@itookit/llm-kernel',
      '@itookit/llm-engine',
      '@itookit/llm-ui',
      '@itookit/app-settings',
      '@itookit/memory-manager'
    ],
    // 预构建第三方依赖
    include: ['mermaid', 'dexie', 'marked', 'immer']
  },

  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    }
  }
});
