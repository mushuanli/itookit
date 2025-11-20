import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: true,
    },
    build: {
        target: 'esnext',
        // 如果你的 monorepo 依赖中有未编译的 TS 文件，可能需要配置 optimizeDeps
    },
    // 如果 @itookit 包是源码形式引入，可能需要此选项来强制预构建
    optimizeDeps: {
        include: [
            '@itookit/common',
            '@itookit/vfs-core',
            '@itookit/mdxeditor',
            '@itookit/memory-manager',
            '@itookit/vfs-ui'
        ]
    }
});