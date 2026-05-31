Build tools by package type:
- Logic-only packages (`common`, `vfslib`, `device-llm`, `llm-kernel`, `llm-engine`, `tools`, vfsdrivers): **tsup** → CJS+ESM + `.d.ts`
- UI packages (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`): **vite build**

## VFS 核心分层

```
IStorageBackend  (IndexedDB / SQLite+FS)     ← 存储后端
    ↕
VFSEngine  (路径解析 / 权限 / 事件 / 插件管道)  ← 引擎核心
    ↕
VFSManager (IVFSManager)  — 模块生命周期协调器
    ↕
ModuleFS (IModuleFS)  — 模块级 chroot 文件系统
    ├── IFSDriver      — POSIX CRUD + 事务 + 搜索
    ├── IFSMetaDriver  — 资产 / 标签 / SeqFile / 引用 / 监听
    └── IFile          — 文件句柄 (FileHandle / MDXFileHandle / ChatFileHandle)
```

所有接口定义在 `packages/common/src/interfaces/fs/`，调用方只依赖接口，不依赖实现。

## 关键文档

| 文档 | 内容 |
|---|---|
| [目录结构](./doc/pkgstructure.md) | 所有 package 及职责 |
| [架构设计](./doc/architecture.md) | 系统全貌 — VFS / LLM / Agent / Skill / Mission / Session |
| [VFS 设计](./doc/design/VFS-design.md) | VFS 详细设计 — 存储 / 引擎 / 挂载 / 权限 / 事件 / 资产 |
| [VFS-UI 设计](./doc/vfsui-design.md) | 文件树 UI 组件设计（部分过期，接口引用以 architecture.md 为准） |

## LLM 子系统速查

### 三层架构：Provider → Connection → Agent

```
LLMProvider (云厂商，持有 apiKey + 模型目录)
    ↕
LLMConnection (绑定 Provider，配置 tier→model 映射，不存 apiKey)
    ↕
AgentDefinition (绑定 Connection + tier 偏好 + system prompt)
```

### 关键类型位置

| 类型 | 文件 |
|---|---|
| `LLMModel`, `LLMProvider`, `LLMConnection`, `ConnectionMeta`, `ModelCategory` | `packages/common/src/interfaces/llm/connection.ts` |
| `ChatMessage`, `MessageContentPart`, `Attachment` | `packages/common/src/interfaces/llm/message.ts` |
| `ProviderCapabilities`, `LLMProviderConfig`, `ModelTier` | `packages/device-llm/src/types/provider.ts` |

### 常见任务 → 关键文件

| 任务 | 文件 |
|---|---|
| 新增内置 Provider | `device-llm/src/constants/providers.ts`（模型目录）+ `device-llm/src/providers/registry.ts`（注册 Provider 类）|
| 新增自定义 Provider 类（非 OpenAI 兼容） | `device-llm/src/providers/` 新增类 → extends `BaseProvider` → 注册到 registry |
| 修改 Provider/Connection UI（设置页） | `llm-ui/src/editors/ProviderSettingsEditor.ts`（Provider 目录编辑）、`ConnectionSettingsEditor.ts`（tier 配置）、`AgentConfigEditor.ts`（Agent 绑定） |
| 修改聊天输入框 UI | `llm-ui/src/components/input/ChatInputView.ts` + `llm-ui/src/components/templates/ChatInputTemplates.ts` |
| 新增/修改 i18n 文案 | `common/src/i18n/zh-CN.ts` 先加 → `en.ts` 同步（必须同步，否则 `LocaleStrings` 类型报错） |
| 新增图标/emoji | `common/src/i18n/icons.ts`（emoji 唯一来源，禁止 UI 组件硬编码） |
| 附件/多模态处理 | `device-llm/src/utils/attachment.ts`（Blob→base64 转换、content part 构建） |
| Provider 请求/响应处理 | `device-llm/src/providers/openai.ts` / `anthropic.ts` / `gemini.ts` |
| Provider 基类 | `device-llm/src/providers/base.ts` |

### UI 约定

- **技术栈**：原生 DOM + 模板字符串（`` renderXxx(): string `` → `container.innerHTML = ...`），事件通过 `addEventListener` 委托绑定
- **CSS 命名**：`settings-xxx`（Settings 编辑器）、`agent-xxx`（Agent 编辑器）、`llm-input__xxx`（ChatInput BEM）
- **图标**：统一从 `@itookit/common` import `ENTITY_ICONS` / `ACTION_ICONS` / `FEEDBACK_ICONS` / `MODEL_CAPABILITY_META` / `MODEL_CATEGORY_META` 等，禁止组件内硬编码 emoji
- **i18n**：`import { t } from '@itookit/common'`，模板中 `` ${t('domain.section.item')} ``，key 格式 `<domain>.<section>.<item>`，插值 `` t('key', { param }) ``
- **可复用样式**：`.settings-badge`（通用徽章）、`.settings-tier-badge`（tier 标签）、`.llm-enable-toggle`（开关 toggle）、`.settings-model-item`（模型行）
