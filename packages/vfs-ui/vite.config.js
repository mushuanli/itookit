// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    // 开启 lib 模式，专门用于构建库
    lib: {
      // **关键**: 回归单一的 JS 入口文件
      entry: resolve(__dirname, 'src/index.js'),
      name: 'VFSUI',
      fileName: 'vfs-ui', // **关键**: 提供一个基础文件名，Vite 会自动添加后缀
    },
    rollupOptions: {
      // 确保外部化处理那些你不想打包进库的依赖
      external: ['immer', '@itookit/common', '@itookit/vfs-core'],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          'immer': 'immer',
          '@itookit/common': 'ItookitCommon',
          '@itookit/vfs-core': 'VFSCore',
        },
        // **关键修改**: 确保 CSS 作为资源文件被正确发射出来
        assetFileNames: (assetInfo) => {
          // 在这里，我们可以确保 CSS 文件被命名为 'style.css'
          if (assetInfo.name.endsWith('.css')) {
            return 'style.css';
          }
          return assetInfo.name;
        },
      },
    },
  },
});
