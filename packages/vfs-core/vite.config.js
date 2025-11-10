// @file vfs-core/vite.config.js
import path from 'path';
import fs from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    // 构建为库
    lib: {
      // 库的入口文件
      entry: resolve(__dirname, 'src/index.js'),
      // 库的全局变量名 (UMD 格式需要)
      name: 'VFSCore',
      // 输出的文件名
      fileName: (format) => `vfs-core.${format}.js`,
    },
    rollupOptions: {
      // 确保外部化处理那些你不想打包进库的依赖
      external: ['uuid', '@itookit/common'],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          uuid: 'uuid',
          '@itookit/common': 'itookitCommon'
        },
      },
    },
  },
  plugins: [
    // 这个插件会自动从你的源码生成 .d.ts 文件
    dts({
      // 清空默认行为，我们手动控制
      cleanVueFileName: true,
      
      // 在构建结束后，手动将我们的 index.d.ts 复制到 dist 目录
      afterBuild: () => {
        const sourcePath = path.resolve(__dirname, 'src/index.d.ts');
        const destPath = path.resolve(__dirname, 'dist/index.d.ts');
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          console.log('[vite:dts-manual] Copied src/index.d.ts to dist/index.d.ts');
        } else {
           console.error('[vite:dts-manual] Error: src/index.d.ts not found!');
        }
      }
    })
  ],
});
