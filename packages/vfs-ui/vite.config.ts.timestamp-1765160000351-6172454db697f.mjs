// vite.config.ts
import { defineConfig } from "file:///home/build/xdr/itookit/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.25/node_modules/vite/dist/node/index.js";
import { resolve } from "path";
import dts from "file:///home/build/xdr/itookit/node_modules/.pnpm/vite-plugin-dts@3.9.1_@types+node@20.19.25_rollup@4.53.3_typescript@5.9.3_vite@5.4.21_@types+node@20.19.25_/node_modules/vite-plugin-dts/dist/index.mjs";
var __vite_injected_original_dirname = "/home/build/xdr/itookit/packages/vfs-ui";
var vite_config_default = defineConfig({
  build: {
    // 开启 lib 模式，专门用于构建库
    lib: {
      // **关键**: 指向 TypeScript 入口文件
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      name: "VFSUI",
      // UMD 构建的全局变量名
      formats: ["es", "umd"],
      fileName: (format) => `vfs-ui.${format === "es" ? "js" : "umd.cjs"}`
    },
    // 【新增】: 强制禁用 CSS 代码拆分，确保所有 CSS 合并为一个文件
    cssCodeSplit: false,
    rollupOptions: {
      // 将无需打包进库的依赖外部化
      external: ["@itookit/vfs-core", "@itookit/common", "immer"],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          "immer": "immer",
          "@itookit/common": "ItookitCommon",
          "@itookit/vfs-core": "VFSCore"
        },
        // 确保CSS被提取为单独的文件
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "style.css";
          }
          return assetInfo.name;
        }
      }
    },
    // 为库构建开启 sourcemap
    sourcemap: true,
    // 清空输出目录
    emptyOutDir: true
  },
  plugins: [
    // 使用 vite-plugin-dts 自动生成类型声明文件
    dts({
      // 指定 rollup 类型声明的入口文件
      entryRoot: "src",
      // 输出目录
      outDir: "dist",
      // 在构建后将所有类型合并到一个文件中
      insertTypesEntry: true
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9idWlsZC94ZHIvaXRvb2tpdC9wYWNrYWdlcy92ZnMtdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL2J1aWxkL3hkci9pdG9va2l0L3BhY2thZ2VzL3Zmcy11aS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9idWlsZC94ZHIvaXRvb2tpdC9wYWNrYWdlcy92ZnMtdWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYnVpbGQ6IHtcbiAgICAvLyBcdTVGMDBcdTU0MkYgbGliIFx1NkEyMVx1NUYwRlx1RkYwQ1x1NEUxM1x1OTVFOFx1NzUyOFx1NEU4RVx1Njc4NFx1NUVGQVx1NUU5M1xuICAgIGxpYjoge1xuICAgICAgLy8gKipcdTUxNzNcdTk1MkUqKjogXHU2MzA3XHU1NDExIFR5cGVTY3JpcHQgXHU1MTY1XHU1M0UzXHU2NTg3XHU0RUY2XG4gICAgICBlbnRyeTogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvaW5kZXgudHMnKSxcbiAgICAgIG5hbWU6ICdWRlNVSScsIC8vIFVNRCBcdTY3ODRcdTVFRkFcdTc2ODRcdTUxNjhcdTVDNDBcdTUzRDhcdTkxQ0ZcdTU0MERcbiAgICAgIGZvcm1hdHM6IFsnZXMnLCAndW1kJ10sXG4gICAgICBmaWxlTmFtZTogKGZvcm1hdCkgPT4gYHZmcy11aS4ke2Zvcm1hdCA9PT0gJ2VzJyA/ICdqcycgOiAndW1kLmNqcyd9YFxuICAgIH0sXG4gICAgLy8gXHUzMDEwXHU2NUIwXHU1ODlFXHUzMDExOiBcdTVGM0FcdTUyMzZcdTc5ODFcdTc1MjggQ1NTIFx1NEVFM1x1NzgwMVx1NjJDNlx1NTIwNlx1RkYwQ1x1Nzg2RVx1NEZERFx1NjI0MFx1NjcwOSBDU1MgXHU1NDA4XHU1RTc2XHU0RTNBXHU0RTAwXHU0RTJBXHU2NTg3XHU0RUY2XG4gICAgY3NzQ29kZVNwbGl0OiBmYWxzZSxcbiAgICBcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAvLyBcdTVDMDZcdTY1RTBcdTk3MDBcdTYyNTNcdTUzMDVcdThGREJcdTVFOTNcdTc2ODRcdTRGOURcdThENTZcdTU5MTZcdTkwRThcdTUzMTZcbiAgICAgIGV4dGVybmFsOiBbJ0BpdG9va2l0L3Zmcy1jb3JlJywgJ0BpdG9va2l0L2NvbW1vbicsICdpbW1lciddLFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIC8vIFx1NTcyOCBVTUQgXHU2Nzg0XHU1RUZBXHU2QTIxXHU1RjBGXHU0RTBCXHU0RTNBXHU4RkQ5XHU0RTlCXHU1OTE2XHU5MEU4XHU1MzE2XHU3Njg0XHU0RjlEXHU4RDU2XHU2M0QwXHU0RjlCXHU0RTAwXHU0RTJBXHU1MTY4XHU1QzQwXHU1M0Q4XHU5MUNGXG4gICAgICAgIGdsb2JhbHM6IHtcbiAgICAgICAgICAnaW1tZXInOiAnaW1tZXInLFxuICAgICAgICAgICdAaXRvb2tpdC9jb21tb24nOiAnSXRvb2tpdENvbW1vbicsXG4gICAgICAgICAgJ0BpdG9va2l0L3Zmcy1jb3JlJzogJ1ZGU0NvcmUnLFxuICAgICAgICB9LFxuICAgICAgICAvLyBcdTc4NkVcdTRGRERDU1NcdTg4QUJcdTYzRDBcdTUzRDZcdTRFM0FcdTUzNTVcdTcyRUNcdTc2ODRcdTY1ODdcdTRFRjZcbiAgICAgICAgYXNzZXRGaWxlTmFtZXM6IChhc3NldEluZm8pID0+IHtcbiAgICAgICAgICBpZiAoYXNzZXRJbmZvLm5hbWUgJiYgYXNzZXRJbmZvLm5hbWUuZW5kc1dpdGgoJy5jc3MnKSkge1xuICAgICAgICAgICAgcmV0dXJuICdzdHlsZS5jc3MnO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYXNzZXRJbmZvLm5hbWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIFx1NEUzQVx1NUU5M1x1Njc4NFx1NUVGQVx1NUYwMFx1NTQyRiBzb3VyY2VtYXBcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgLy8gXHU2RTA1XHU3QTdBXHU4RjkzXHU1MUZBXHU3NkVFXHU1RjU1XG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG4gIHBsdWdpbnM6IFtcbiAgICAvLyBcdTRGN0ZcdTc1Mjggdml0ZS1wbHVnaW4tZHRzIFx1ODFFQVx1NTJBOFx1NzUxRlx1NjIxMFx1N0M3Qlx1NTc4Qlx1NThGMFx1NjYwRVx1NjU4N1x1NEVGNlxuICAgIGR0cyh7XG4gICAgICAvLyBcdTYzMDdcdTVCOUEgcm9sbHVwIFx1N0M3Qlx1NTc4Qlx1NThGMFx1NjYwRVx1NzY4NFx1NTE2NVx1NTNFM1x1NjU4N1x1NEVGNlxuICAgICAgZW50cnlSb290OiAnc3JjJyxcbiAgICAgIC8vIFx1OEY5M1x1NTFGQVx1NzZFRVx1NUY1NVxuICAgICAgb3V0RGlyOiAnZGlzdCcsXG4gICAgICAvLyBcdTU3MjhcdTY3ODRcdTVFRkFcdTU0MEVcdTVDMDZcdTYyNDBcdTY3MDlcdTdDN0JcdTU3OEJcdTU0MDhcdTVFNzZcdTUyMzBcdTRFMDBcdTRFMkFcdTY1ODdcdTRFRjZcdTRFMkRcbiAgICAgIGluc2VydFR5cGVzRW50cnk6IHRydWUsXG4gICAgfSlcbiAgXVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXVTLFNBQVMsb0JBQW9CO0FBQ3BVLFNBQVMsZUFBZTtBQUN4QixPQUFPLFNBQVM7QUFGaEIsSUFBTSxtQ0FBbUM7QUFJekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsT0FBTztBQUFBO0FBQUEsSUFFTCxLQUFLO0FBQUE7QUFBQSxNQUVILE9BQU8sUUFBUSxrQ0FBVyxjQUFjO0FBQUEsTUFDeEMsTUFBTTtBQUFBO0FBQUEsTUFDTixTQUFTLENBQUMsTUFBTSxLQUFLO0FBQUEsTUFDckIsVUFBVSxDQUFDLFdBQVcsVUFBVSxXQUFXLE9BQU8sT0FBTyxTQUFTO0FBQUEsSUFDcEU7QUFBQTtBQUFBLElBRUEsY0FBYztBQUFBLElBRWQsZUFBZTtBQUFBO0FBQUEsTUFFYixVQUFVLENBQUMscUJBQXFCLG1CQUFtQixPQUFPO0FBQUEsTUFDMUQsUUFBUTtBQUFBO0FBQUEsUUFFTixTQUFTO0FBQUEsVUFDUCxTQUFTO0FBQUEsVUFDVCxtQkFBbUI7QUFBQSxVQUNuQixxQkFBcUI7QUFBQSxRQUN2QjtBQUFBO0FBQUEsUUFFQSxnQkFBZ0IsQ0FBQyxjQUFjO0FBQzdCLGNBQUksVUFBVSxRQUFRLFVBQVUsS0FBSyxTQUFTLE1BQU0sR0FBRztBQUNyRCxtQkFBTztBQUFBLFVBQ1Q7QUFDQSxpQkFBTyxVQUFVO0FBQUEsUUFDbkI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxXQUFXO0FBQUE7QUFBQSxJQUVYLGFBQWE7QUFBQSxFQUNmO0FBQUEsRUFDQSxTQUFTO0FBQUE7QUFBQSxJQUVQLElBQUk7QUFBQTtBQUFBLE1BRUYsV0FBVztBQUFBO0FBQUEsTUFFWCxRQUFRO0FBQUE7QUFBQSxNQUVSLGtCQUFrQjtBQUFBLElBQ3BCLENBQUM7QUFBQSxFQUNIO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
