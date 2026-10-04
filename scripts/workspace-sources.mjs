// @file: scripts/workspace-sources.mjs
// 桌面端与 Web 端 dev server 共用的 workspace 源码映射。
//
// 为什么不变量成立：`packages/*` 的 `exports`/`main` 都指向 `src/index.ts`，所以别名解析到的
// 文件与打包器本来会选的文件完全相同；别名只让"同一份源码在 dev 图里只有一个副本"成为显式
// 约定。曾经两端各自维护一份不完整的别名列表（桌面端漏了 durable-kernel/app-core/app-shell
// 等，Web 端漏了另一批），长驻 dev server 因此在改库源码后可能同时提供新旧两份转译结果，
// 表现为 `x is not a function`。这里改成单一来源，两端都从这里取。
//
// 维护：新增/删除 package 后更新 `WORKSPACE_SOURCES`（条目必须存在且能被浏览器打包）。

import path from 'node:path';

/** `[包名, 相对仓库根的源码入口]`；入口必须与 package.json 的 exports/main 一致。 */
export const WORKSPACE_SOURCES = [
    ['@itookit/app-core', 'packages/app-core/src/index.ts'],
    ['@itookit/app-settings', 'packages/app-settings/src/index.ts'],
    ['@itookit/app-shell', 'packages/app-shell/src/index.ts'],
    ['@itookit/common', 'packages/common/src/index.ts'],
    ['@itookit/llm-context', 'packages/llm-context/src/index.ts'],
    ['@itookit/driver-llm', 'packages/driver-llm/src/index.ts'],
    ['@itookit/device-tty', 'packages/device-tty/src/index.ts'],
    ['@itookit/durable-kernel', 'packages/durable-kernel/src/index.ts'],
    ['@itookit/kernel-adapters', 'packages/kernel-adapters/src/index.ts'],
    ['@itookit/llm-flow', 'packages/llm-flow/src/index.ts'],
    ['@itookit/llm-session', 'packages/llm-session/src/index.ts'],
    ['@itookit/llm-settings-ui', 'packages/llm-settings-ui/src/index.ts'],
    ['@itookit/llm-tasks', 'packages/llm-tasks/src/index.ts'],
    ['@itookit/llm-ui', 'packages/llm-ui/src/index.ts'],
    ['@itookit/mdxeditor', 'packages/mdx/src/index.ts'],
    ['@itookit/sanbox', 'packages/sanbox/src/index.ts'],
    ['@itookit/tools', 'packages/tools/src/index.ts'],
    ['@itookit/ui-common', 'packages/ui-common/src/index.ts'],
    ['@itookit/vfs-core', 'packages/vfs-core/src/index.ts'],
    ['@itookit/vfs-ui', 'packages/vfs-ui/src/index.ts'],
    ['@itookit/vfsdriver-indexeddb', 'packages/vfsdriver-indexeddb/src/index.ts'],
    ['@itookit/vfsdriver-local', 'packages/vfsdriver-local/src/index.ts'],
];

/**
 * 包内子路径入口（CSS）。
 *
 * 用字符串 find 时别名按前缀匹配，所以这些条目必须排在包根之前；
 * 包根本身改用正则精确匹配，包内其它子路径（如 `@itookit/durable-kernel/core`）
 * 因此仍走 package.json 的 `exports`，不会被拼成 `.../src/index.ts/core`。
 */
const WORKSPACE_SUBPATHS = [
    ['@itookit/app-shell/navigation.css', 'packages/app-shell/src/styles/navigation.css'],
    ['@itookit/app-settings/style.css', 'packages/app-settings/src/styles/styles.css'],
    ['@itookit/llm-ui/style.css', 'packages/llm-ui/src/styles/index.css'],
    ['@itookit/mdxeditor/style.css', 'packages/mdx/src/styles/index.css'],
    ['@itookit/vfs-ui/style.css', 'packages/vfs-ui/src/styles/index.css'],
];

/** 仓库根目录：调用方（vite.config.ts）用 `path.resolve(__dirname, '../..')` 传入。 */
function repositoryRoot(appDir) {
    return path.resolve(appDir, '../..');
}

/**
 * `resolve.alias` 的数组形式（不要改成对象，对象只能表达前缀匹配）。
 *
 * 子路径入口在前，包根用 `^包名$` 精确匹配；这既保证 dev 图里每包一份源码，
 * 又不会吞掉包内其它 `exports` 子路径。
 */
export function workspaceAliases(appDir) {
    const root = repositoryRoot(appDir);
    return [
        ...WORKSPACE_SUBPATHS.map(([find, source]) => ({ find, replacement: path.resolve(root, source) })),
        ...WORKSPACE_SOURCES.map(([name, source]) => ({
            find: new RegExp(`^${name}$`), replacement: path.resolve(root, source),
        })),
    ];
}

/** `optimizeDeps.exclude`：这些包一律按源码处理，不进入依赖预打包。 */
export function workspaceExcludes() {
    return WORKSPACE_SOURCES.map(([specifier]) => specifier);
}
