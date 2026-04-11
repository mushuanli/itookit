// vite.config.ts
import { defineConfig } from "file:///Users/rain_li/share/x1/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.25/node_modules/vite/dist/node/index.js";

// ../../scripts/vite-lib.config.ts
import { resolve } from "path";
import dts from "vite-plugin-dts";
function createLibConfig(options) {
  const {
    name,
    fileName,
    entry = "src/index.ts",
    external = [],
    globals = {},
    rootDir
  } = options;
  return {
    build: {
      lib: {
        entry: resolve(rootDir, entry),
        name,
        formats: ["es", "umd"],
        fileName: (format) => `${fileName}.${format === "es" ? "js" : "umd.cjs"}`
      },
      cssCodeSplit: false,
      rollupOptions: {
        external,
        output: {
          globals,
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith(".css")) return "style.css";
            return assetInfo.name || "asset";
          }
        }
      },
      sourcemap: true,
      emptyOutDir: true
    },
    plugins: [
      dts({
        entryRoot: "src",
        outDir: "dist",
        insertTypesEntry: true
      })
    ]
  };
}

// vite.config.ts
var __vite_injected_original_dirname = "/Users/rain_li/share/x1/packages/mdx";
var vite_config_default = defineConfig(
  createLibConfig({
    name: "MDxEditor",
    fileName: "mdxeditor",
    rootDir: __vite_injected_original_dirname,
    external: [
      "@itookit/common",
      "@itookit/vfs",
      // 建议保留正则作为兜底，但必须显式添加报错的包
      /^@codemirror\//,
      "codemirror",
      "marked",
      "mermaid",
      "front-matter",
      "gray-matter",
      // --- 👇 显式添加这些 CodeMirror 子包 ---
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/lang-markdown"
    ],
    globals: {
      "@itookit/common": "ItookitCommon",
      "@itookit/vfs": "VFSCore",
      "codemirror": "CodeMirror",
      "marked": "marked",
      "mermaid": "mermaid",
      "front-matter": "fm",
      // 修复 front-matter 警告
      "gray-matter": "gm",
      // 手动补充 CodeMirror 的子模块映射以消除警告
      "@codemirror/state": "CM.state",
      "@codemirror/view": "CM.view",
      "@codemirror/commands": "CM.commands",
      "@codemirror/language": "CM.language",
      "@codemirror/autocomplete": "CM.autocomplete",
      "@codemirror/lint": "CM.lint",
      "@codemirror/search": "CM.search",
      "@codemirror/lang-markdown": "CM.langMarkdown"
    }
  })
);
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAiLi4vLi4vc2NyaXB0cy92aXRlLWxpYi5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcmFpbl9saS9zaGFyZS94MS9wYWNrYWdlcy9tZHhcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9yYWluX2xpL3NoYXJlL3gxL3BhY2thZ2VzL21keC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcmFpbl9saS9zaGFyZS94MS9wYWNrYWdlcy9tZHgvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IGNyZWF0ZUxpYkNvbmZpZyB9IGZyb20gJy4uLy4uL3NjcmlwdHMvdml0ZS1saWIuY29uZmlnJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKFxuICBjcmVhdGVMaWJDb25maWcoe1xuICAgIG5hbWU6ICdNRHhFZGl0b3InLFxuICAgIGZpbGVOYW1lOiAnbWR4ZWRpdG9yJyxcbiAgICByb290RGlyOiBfX2Rpcm5hbWUsXG4gICAgZXh0ZXJuYWw6IFtcbiAgICAgICdAaXRvb2tpdC9jb21tb24nLFxuICAgICAgJ0BpdG9va2l0L3ZmcycsXG4gICAgICAvLyBcdTVFRkFcdThCQUVcdTRGRERcdTc1NTlcdTZCNjNcdTUyMTlcdTRGNUNcdTRFM0FcdTUxNUNcdTVFOTVcdUZGMENcdTRGNDZcdTVGQzVcdTk4N0JcdTY2M0VcdTVGMEZcdTZERkJcdTUyQTBcdTYyQTVcdTk1MTlcdTc2ODRcdTUzMDVcbiAgICAgIC9eQGNvZGVtaXJyb3JcXC8vLCAgICAgIFxuICAgICAgJ2NvZGVtaXJyb3InLFxuICAgICAgJ21hcmtlZCcsXG4gICAgICAnbWVybWFpZCcsXG4gICAgICAnZnJvbnQtbWF0dGVyJyxcbiAgICAgICdncmF5LW1hdHRlcicsXG4gICAgICAvLyAtLS0gXHVEODNEXHVEQzQ3IFx1NjYzRVx1NUYwRlx1NkRGQlx1NTJBMFx1OEZEOVx1NEU5QiBDb2RlTWlycm9yIFx1NUI1MFx1NTMwNSAtLS1cbiAgICAgICdAY29kZW1pcnJvci9zdGF0ZScsXG4gICAgICAnQGNvZGVtaXJyb3IvdmlldycsXG4gICAgICAnQGNvZGVtaXJyb3IvY29tbWFuZHMnLFxuICAgICAgJ0Bjb2RlbWlycm9yL2xhbmd1YWdlJyxcbiAgICAgICdAY29kZW1pcnJvci9hdXRvY29tcGxldGUnLFxuICAgICAgJ0Bjb2RlbWlycm9yL2xpbnQnLFxuICAgICAgJ0Bjb2RlbWlycm9yL3NlYXJjaCcsXG4gICAgICAnQGNvZGVtaXJyb3IvbGFuZy1tYXJrZG93bidcbiAgICBdLFxuICAgIGdsb2JhbHM6IHtcbiAgICAgICdAaXRvb2tpdC9jb21tb24nOiAnSXRvb2tpdENvbW1vbicsXG4gICAgICAnQGl0b29raXQvdmZzJzogJ1ZGU0NvcmUnLFxuICAgICAgJ2NvZGVtaXJyb3InOiAnQ29kZU1pcnJvcicsXG4gICAgICAnbWFya2VkJzogJ21hcmtlZCcsXG4gICAgICAnbWVybWFpZCc6ICdtZXJtYWlkJyxcbiAgICAgICdmcm9udC1tYXR0ZXInOiAnZm0nLCAvLyBcdTRGRUVcdTU5MEQgZnJvbnQtbWF0dGVyIFx1OEI2Nlx1NTQ0QVxuICAgICAgJ2dyYXktbWF0dGVyJzogJ2dtJyxcbiAgICAgIC8vIFx1NjI0Qlx1NTJBOFx1ODg2NVx1NTE0NSBDb2RlTWlycm9yIFx1NzY4NFx1NUI1MFx1NkEyMVx1NTc1N1x1NjYyMFx1NUMwNFx1NEVFNVx1NkQ4OFx1OTY2NFx1OEI2Nlx1NTQ0QVxuICAgICAgJ0Bjb2RlbWlycm9yL3N0YXRlJzogJ0NNLnN0YXRlJyxcbiAgICAgICdAY29kZW1pcnJvci92aWV3JzogJ0NNLnZpZXcnLFxuICAgICAgJ0Bjb2RlbWlycm9yL2NvbW1hbmRzJzogJ0NNLmNvbW1hbmRzJyxcbiAgICAgICdAY29kZW1pcnJvci9sYW5ndWFnZSc6ICdDTS5sYW5ndWFnZScsXG4gICAgICAnQGNvZGVtaXJyb3IvYXV0b2NvbXBsZXRlJzogJ0NNLmF1dG9jb21wbGV0ZScsXG4gICAgICAnQGNvZGVtaXJyb3IvbGludCc6ICdDTS5saW50JyxcbiAgICAgICdAY29kZW1pcnJvci9zZWFyY2gnOiAnQ00uc2VhcmNoJyxcbiAgICAgICdAY29kZW1pcnJvci9sYW5nLW1hcmtkb3duJzogJ0NNLmxhbmdNYXJrZG93bidcbiAgICB9XG4gIH0pXG4pO1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcmFpbl9saS9zaGFyZS94MS9zY3JpcHRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvcmFpbl9saS9zaGFyZS94MS9zY3JpcHRzL3ZpdGUtbGliLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcmFpbl9saS9zaGFyZS94MS9zY3JpcHRzL3ZpdGUtbGliLmNvbmZpZy50c1wiO2ltcG9ydCB7IFVzZXJDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcblxuZXhwb3J0IGludGVyZmFjZSBMaWJDb25maWdPcHRpb25zIHtcbiAgbmFtZTogc3RyaW5nOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVU1EIFx1NTE2OFx1NUM0MFx1NTNEOFx1OTFDRlx1NTQwRFxuICBmaWxlTmFtZTogc3RyaW5nOyAgICAgICAgICAgICAgICAgICAgICAvLyBcdThGOTNcdTUxRkFcdTY1ODdcdTRFRjZcdTU0MERcdTUyNERcdTdGMDBcbiAgZW50cnk/OiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gXHU1MTY1XHU1M0UzXHU2NTg3XHU0RUY2XHU4REVGXHU1Rjg0XG4gIGV4dGVybmFsPzogKHN0cmluZyB8IFJlZ0V4cClbXTsgICAgICAgIC8vIFx1NTkxNlx1OTBFOFx1NEY5RFx1OEQ1NlxuICBnbG9iYWxzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjsgICAgICAvLyBVTUQgZ2xvYmFscyBcdTY2MjBcdTVDMDRcbiAgcm9vdERpcjogc3RyaW5nOyAgICAgICAgICAgICAgICAgICAgICAgLy8gXHU1MzA1XHU3Njg0XHU2ODM5XHU3NkVFXHU1RjU1IChfX2Rpcm5hbWUpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMaWJDb25maWcob3B0aW9uczogTGliQ29uZmlnT3B0aW9ucyk6IFVzZXJDb25maWcge1xuICBjb25zdCB7XG4gICAgbmFtZSxcbiAgICBmaWxlTmFtZSxcbiAgICBlbnRyeSA9ICdzcmMvaW5kZXgudHMnLFxuICAgIGV4dGVybmFsID0gW10sXG4gICAgZ2xvYmFscyA9IHt9LFxuICAgIHJvb3REaXJcbiAgfSA9IG9wdGlvbnM7XG5cbiAgcmV0dXJuIHtcbiAgICBidWlsZDoge1xuICAgICAgbGliOiB7XG4gICAgICAgIGVudHJ5OiByZXNvbHZlKHJvb3REaXIsIGVudHJ5KSxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZm9ybWF0czogWydlcycsICd1bWQnXSxcbiAgICAgICAgZmlsZU5hbWU6IChmb3JtYXQpID0+IGAke2ZpbGVOYW1lfS4ke2Zvcm1hdCA9PT0gJ2VzJyA/ICdqcycgOiAndW1kLmNqcyd9YFxuICAgICAgfSxcbiAgICAgIGNzc0NvZGVTcGxpdDogZmFsc2UsXG4gICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgIGV4dGVybmFsLFxuICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICBnbG9iYWxzLFxuICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiAoYXNzZXRJbmZvKSA9PiB7XG4gICAgICAgICAgICBpZiAoYXNzZXRJbmZvLm5hbWU/LmVuZHNXaXRoKCcuY3NzJykpIHJldHVybiAnc3R5bGUuY3NzJztcbiAgICAgICAgICAgIHJldHVybiBhc3NldEluZm8ubmFtZSB8fCAnYXNzZXQnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgIGVtcHR5T3V0RGlyOiB0cnVlXG4gICAgfSxcbiAgICBwbHVnaW5zOiBbXG4gICAgICBkdHMoe1xuICAgICAgICBlbnRyeVJvb3Q6ICdzcmMnLFxuICAgICAgICBvdXREaXI6ICdkaXN0JyxcbiAgICAgICAgaW5zZXJ0VHlwZXNFbnRyeTogdHJ1ZVxuICAgICAgfSlcbiAgICBdXG4gIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQThSLFNBQVMsb0JBQW9COzs7QUNDM1QsU0FBUyxlQUFlO0FBQ3hCLE9BQU8sU0FBUztBQVdULFNBQVMsZ0JBQWdCLFNBQXVDO0FBQ3JFLFFBQU07QUFBQSxJQUNKO0FBQUEsSUFDQTtBQUFBLElBQ0EsUUFBUTtBQUFBLElBQ1IsV0FBVyxDQUFDO0FBQUEsSUFDWixVQUFVLENBQUM7QUFBQSxJQUNYO0FBQUEsRUFDRixJQUFJO0FBRUosU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0wsS0FBSztBQUFBLFFBQ0gsT0FBTyxRQUFRLFNBQVMsS0FBSztBQUFBLFFBQzdCO0FBQUEsUUFDQSxTQUFTLENBQUMsTUFBTSxLQUFLO0FBQUEsUUFDckIsVUFBVSxDQUFDLFdBQVcsR0FBRyxRQUFRLElBQUksV0FBVyxPQUFPLE9BQU8sU0FBUztBQUFBLE1BQ3pFO0FBQUEsTUFDQSxjQUFjO0FBQUEsTUFDZCxlQUFlO0FBQUEsUUFDYjtBQUFBLFFBQ0EsUUFBUTtBQUFBLFVBQ047QUFBQSxVQUNBLGdCQUFnQixDQUFDLGNBQWM7QUFDN0IsZ0JBQUksVUFBVSxNQUFNLFNBQVMsTUFBTSxFQUFHLFFBQU87QUFDN0MsbUJBQU8sVUFBVSxRQUFRO0FBQUEsVUFDM0I7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsV0FBVztBQUFBLE1BQ1gsYUFBYTtBQUFBLElBQ2Y7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQLElBQUk7QUFBQSxRQUNGLFdBQVc7QUFBQSxRQUNYLFFBQVE7QUFBQSxRQUNSLGtCQUFrQjtBQUFBLE1BQ3BCLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGOzs7QURyREEsSUFBTSxtQ0FBbUM7QUFHekMsSUFBTyxzQkFBUTtBQUFBLEVBQ2IsZ0JBQWdCO0FBQUEsSUFDZCxNQUFNO0FBQUEsSUFDTixVQUFVO0FBQUEsSUFDVixTQUFTO0FBQUEsSUFDVCxVQUFVO0FBQUEsTUFDUjtBQUFBLE1BQ0E7QUFBQTtBQUFBLE1BRUE7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBO0FBQUEsTUFFQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCxtQkFBbUI7QUFBQSxNQUNuQixnQkFBZ0I7QUFBQSxNQUNoQixjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsTUFDVixXQUFXO0FBQUEsTUFDWCxnQkFBZ0I7QUFBQTtBQUFBLE1BQ2hCLGVBQWU7QUFBQTtBQUFBLE1BRWYscUJBQXFCO0FBQUEsTUFDckIsb0JBQW9CO0FBQUEsTUFDcEIsd0JBQXdCO0FBQUEsTUFDeEIsd0JBQXdCO0FBQUEsTUFDeEIsNEJBQTRCO0FBQUEsTUFDNUIsb0JBQW9CO0FBQUEsTUFDcEIsc0JBQXNCO0FBQUEsTUFDdEIsNkJBQTZCO0FBQUEsSUFDL0I7QUFBQSxFQUNGLENBQUM7QUFDSDsiLAogICJuYW1lcyI6IFtdCn0K
