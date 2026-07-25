```bash
pnpm --filter @itookit/demo add -D vite typescript @codemirror/view @codemirror/state @codemirror/commands @codemirror/lang-javascript @codemirror/language @codemirror/autocomplete
pnpm --filter @itookit/demo run dev
```

---

### 目标

在同一个代码仓库中，创建和发布两个包：
1.  `@itookit/llmdriver` (基础库)
2.  `@itookit/mdxeditor` (依赖于 `llmdriver` 的编辑器库)

### 准备工作

1.  **注册 NPM 账号**: 前往 [npmjs.com](https://www.npmjs.com/) 注册。
2.  **创建 NPM 组织**: 登录后，点击头像 -> "Add Organization"，创建一个免费组织，名称为 `itookit`。这将是你的包的作用域 (`@itookit`)。
3.  **安装 pnpm**: 它是管理 Monorepo 的最佳工具。
    ```bash
    npm install -g pnpm
    ```

---

### 核心步骤

#### 第 1 步：创建 Monorepo 项目

```bash
# 1. 创建项目文件夹
mkdir itookit-project
cd itookit-project

# 2. 初始化项目 (根目录)
pnpm init

# 3. 告诉 pnpm 这是一个 workspace
#    创建 pnpm-workspace.yaml 文件，内容如下:
packages:
  - 'packages/*'

# 4. 创建存放所有包的目录
mkdir packages
```
**关键**: 修改根目录的 `package.json`，添加 `"private": true`，防止根目录被意外发布。

#### 第 2 步：创建你的第一个包 (`llmdriver`)

```bash
# 1. 进入 packages 目录并创建包文件夹
cd packages
mkdir llmdriver
cd llmdriver

# 2. 初始化包
pnpm init
```

**关键**: 修改 `packages/llmdriver/package.json` 文件：

```json
{
  "name": "@itookit/llmdriver",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "echo 'build script here'"
  },
  "publishConfig": {
    "access": "public" 
  }
}
```
> **`name`**: 必须是 `@作用域/包名` 格式。
> **`publishConfig`**: `access: "public"` 是发布免费作用域包的**必需项**。

#### 第 3 步：创建第二个包 (`mdxeditor`) 并添加依赖

1.  **创建 `mdxeditor`**: 重复第 2 步，创建 `packages/mdxeditor` 并修改其 `package.json`，将 `name` 设置为 `@itookit/mdxeditor`。

2.  **添加内部依赖**: 假设 `mdxeditor` 需要用到 `llmdriver`。**在项目根目录**运行：
    ```bash
    # 告诉 pnpm，在 @itookit/mdxeditor 包里，添加 @itookit/llmdriver 这个依赖
    pnpm add @itookit/llmdriver --filter @itookit/mdxeditor
    ```
    pnpm 会自动处理好本地包之间的链接，你对 `llmdriver` 的修改会立即在 `mdxeditor` 中生效。

#### 第 4 步：添加统一构建脚本

1.  **安装构建工具**: 在**项目根目录**安装 `typescript` 和 `tsup` (一个超棒的打包工具)。
    ```bash
    # -wD 表示安装到 workspace 的根目录，作为开发依赖
    pnpm add -wD typescript tsup
    ```

2.  **配置构建命令**: 修改**每个子包** (`llmdriver` 和 `mdxeditor`) 的 `package.json`：
    ```json
    "scripts": {
      "build": "tsup src/index.ts --format cjs,esm --dts",
      "dev": "pnpm build --watch"
    },
    ```
    > 这会打包 `src/index.ts` 文件，生成 `cjs` 和 `esm` 两种格式，并创建类型声明文件 (`.d.ts`)。

3.  **添加根构建命令**: 修改**项目根目录**的 `package.json`，这样就可以一键构建所有包。
    ```json
    "scripts": {
      "build": "pnpm --filter \"./packages/*\" run build"
    },
    ```

#### 第 5 步：发布到 NPM

1.  **登录 NPM**:
    ```bash
    npm login
    ```
    (输入你的 NPM 用户名、密码)

2.  **构建所有包**:
    ```bash
    # 在项目根目录运行
    pnpm build
    ```

3.  **更新版本号**: 在发布前，手动修改你要发布的包的 `package.json` 里的 `"version"` 字段（例如 `0.1.0` -> `0.1.1`）。

4.  **发布**:
    ```bash
    # 在项目根目录运行，pnpm 会自动发布所有版本号有更新的包
    pnpm -r publish
    ```
    > pnpm 会自动跳过 `private: true` 的包和版本未变的包。

---

### 总结流程

1.  `pnpm init` 创建项目，配置 `pnpm-workspace.yaml`。
2.  在 `packages/` 目录下创建子包，修改 `package.json`：
    *   `"name": "@your-scope/package-name"`
    *   `"publishConfig": { "access": "public" }`
3.  使用 `pnpm add <dependency> --filter <target-package>` 添加依赖。
4.  在根目录添加统一的 `build` 脚本。
5.  `npm login` -> `pnpm build` -> **更新版本号** -> `pnpm -r publish`。

搞定！现在你可以用这个流程轻松管理和发布你的 `itookit` 系列库了。
