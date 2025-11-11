// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      // 确保 d.ts 文件被打包到 dist/types 目录，并最终汇总到 dist/index.d.ts
      insertTypesEntry: true,
    }),
  ],
  build: {
    // 开启 lib 模式，专门用于构建库
    lib: {
      // 指定库的入口文件
      entry: resolve(__dirname, 'src/index.js'),
      // UMD 模式下，暴露的全局变量名
      name: 'VFSUI',
      // 构建后输出的文件名
      fileName: (format) => `vfs-ui.${format}.js`,
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
      },
    },
  },
});
