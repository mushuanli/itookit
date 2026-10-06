# 独立 npm 库接入

itookit 通过 npm 注册表安装以下库，源码不再作为工作区包或 Git 子模块参与构建。

| npm 包 | 固定版本 | 源码仓库 |
|---|---|---|
| @itookit/vfs-core | 5.3.1 | [vfs-core](https://github.com/mushuanli/vfs-core) |
| @itookit/vfs-ui | 0.5.5 | [vfs-ui](https://github.com/mushuanli/vfs-ui) |
| @itookit/vfsdriver-indexeddb | 5.3.1 | [vfsdriver-indexeddb](https://github.com/mushuanli/vfsdriver-indexeddb) |
| @itookit/vfsdriver-local | 5.3.0 | [vfsdriver-local](https://github.com/mushuanli/vfsdriver-local) |
| @itookit/vfsdriver-agent | 5.3.0 | [vfsdriver-agent](https://github.com/mushuanli/vfsdriver-agent) |
| @itookit/vfs-sync | 0.1.0 | [vfs-sync](https://github.com/mushuanli/vfs-sync) |
| @itookit/mdxeditor | 0.5.1 | [mdxeditor](https://github.com/mushuanli/mdxeditor) |
| @itookit/driver-llm | 0.2.0 | [driver-llm](https://github.com/mushuanli/driver-llm) |

## 安装与开发

应用执行 `pnpm install --frozen-lockfile` 后即可开发与构建。Vite、TypeScript 和测试只解析库的公开 exports；测试替身由宿主测试目录维护，不导入独立仓库的私有测试文件。vfs-ui CSS 使用 `@itookit/vfs-ui/style.css`，MDX CSS 使用 `@itookit/mdxeditor/style.css`。

独立仓库位于 `../pair-x1/<仓库名>`，移动这些源码不会影响 itookit。修改库时，在对应仓库安装依赖、测试、构建和发布新版本，再更新应用固定版本与锁文件。应用不会自动使用旁边仓库的新代码。

## 发布流程

`scripts/npm-libraries.json` 固定发布集合与版本。先更新其中的版本，再执行：

```bash
pnpm npm:prepare
# 或 node scripts/release-npm-libraries.mjs prepare /其他源码父目录
pnpm npm:publish
pnpm npm:migrate
pnpm install
```

prepare 从独立仓库构建，检查导出文件，固定库间依赖，并保存 tarball 与 SHA-256。publish 校验 tarball 未被修改后发布；npm 版本不可覆盖，已发布版本不得再次发布。迁移前核对注册表中全部版本已可用，避免半数版本不可安装时改动应用依赖。

首次迁移使用 `scripts/relocate-npm-libraries.mjs` 保存原子模块到独立仓库；该脚本拒绝覆盖已有目录。原工作目录保留在被忽略的 `release/source-checkouts/` 作为临时备份，不参加安装、构建或测试。

## 验证边界

独立库的单元测试在各自仓库运行；应用保留跨库集成测试。根目录提供八个库的开发依赖，供公共契约测试与边界检查读取实际安装包的 exports。工作区排除同名源码目录，避免重新创建目录后悄悄恢复本地链接。

发布前验证 ESM、CommonJS、CSS 导出及各库适用的 TypeScript 类型解析；VFS 库额外验证 SeqFile 读写。MDX 的类型消费使用 `moduleResolution: bundler`。应用迁移后须在八个源码目录缺席时通过类型检查、公共接口边界检查、文档检查、样式检查、应用构建与集成测试。

MDX 核心已拆分至独立仓库并保留历史，本地独立 checkout 在 `../pair-x1/mdxeditor/`，x1 仅保留 npm 包引用。MindOS 的 VFS、Session、附件管理与会话打印继续由工作区内的 `@itookit/mdx-adapter` 适配。宿主测试只使用编辑器公开接口，文档策略与链接解析单元测试由独立仓库维护。

### MDX 拆分验证（2026-10-05）

- 独立安装、类型检查、37 项单元测试、构建及 tarball 打包通过；tarball 消费验证 ESM、CommonJS、TypeScript bundler 类型与 CSS 导出。
- x1 在 `packages/mdx` 缺席时，冻结锁文件离线安装、全仓类型检查、架构/文档/样式检查、Web 与 Tauri 前端构建通过。
- mdx-adapter 18 项测试及 CLI 原子保存集成测试通过；app-shell 首轮 507 项通过，受沙箱进程/端口限制的三个测试文件在沙箱外复跑 8 项通过。
- Tauri 对发布库使用的无前缀 Node 内置模块也执行 external，避免 Vite 将 LocalFS 的 `fs` 导入解析为浏览器空模块。
