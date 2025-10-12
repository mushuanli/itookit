
#### 1. 架构思想 (Architectural Philosophy)

*   **组件化 (Component-based):** 整个 UI 被拆分为三个核心业务组件 (`LibrarySettings`, `AgentEditor`, `WorkflowManager`) 和一个主协调器 (`SettingsManagerUI`)。每个组件都封装了自己的视图（V）、逻辑（C）和部分状态（M），职责清晰。
*   **依赖倒置 (Dependency Inversion):** 这是本次重构最亮眼的设计。通过在构造函数中注入回调函数（`onConfigChange`, `onAgentsChange`, `onSave`, `onRun`, `onTest`, `onNotify`），UI 组件不再依赖于外部的具体实现。
    *   `LibrarySettings` 不知道“如何”测试连接，它只知道“何时”调用 `onTest`。
    *   所有组件都不知道“如何”通知用户，它们只知道“何时”调用 `onNotify`。
    *   这使得核心 UI 库与宿主应用的业务逻辑（如 API 请求、通知系统）完全解耦，极大地增强了库的可重用性和可测试性。
*   **单向数据流 (Unidirectional Data Flow):** 状态管理的模式非常清晰。
    1.  **加载**: `SettingsManagerUI` 通过 `StorageAdapter` 加载初始数据。
    2.  **分发**: 数据被分发给各个子组件进行渲染。
    3.  **变更**: 用户在子组件中操作，触发变更。
    4.  **上报**: 子组件通过 `on...Change` 回调将**完整的、最新的数据**上报给 `SettingsManagerUI`。
    5.  **持久化**: `SettingsManagerUI` 调用 `StorageAdapter` 保存数据。
    6.  **同步**: `SettingsManagerUI` 将更新后的数据**重新分发**给可能受影响的其他子组件（例如，Connections 改变后，需通知 AgentEditor 更新其下拉列表）。
    这种模式使得状态变化可预测、易于追踪和调试。

#### 2. 核心组件接口与功能

*   **`SettingsManagerUI` (协调器/Orchestrator)**
    *   **入口**: `SettingsManagerUI.create(element, options)` 静态工厂方法，封装了异步加载数据的初始化流程。
    *   **核心职责**:
        1.  **生命周期管理**: 初始化、加载数据、销毁。
        2.  **布局渲染**: 渲染顶层 Tab 布局和容器。
        3.  **组件实例化**: 创建 `LibrarySettings`, `AgentEditor`, `WorkflowManager` 的实例，并为它们注入必要的依赖（数据和回调）。
        4.  **状态中继**: 作为数据流的中心枢纽，接收一个组件的数据变更，并将其同步给其他相关组件。
    *   **关键接口 (`options`)**:
        *   `storageAdapter`: **必需**。定义了数据持久化的方式，是整个库解耦的关键。
        *   `onWorkflowRun`: 业务逻辑回调，定义了点击“运行”工作流后应执行的操作。
        *   `onTestConnection`: 业务逻辑回调，定义了点击“测试连接”后应执行的操作。
        *   `customSettingsTabs`: **扩展性接口**。允许宿主应用注入自定义的设置页面，设计非常优秀。

*   **`LibrarySettings` (连接管理)**
    *   **功能**: 提供对 `ProviderConnection` 对象的完整 CRUD（创建、读取、更新、删除）操作。
    *   **UI**: 经典的主从（Master-Detail）布局。
    *   **核心特性**:
        1.  **连接测试**: UI 上有明确的测试按钮和状态反馈区。
        2.  **模型管理**: 为每个连接提供了一个动态的、可增删的可用模型列表编辑器。这是解决核心数据模型问题的关键实现。

*   **`AgentEditor` (智能体管理)**
    *   **功能**: 提供对 `AgentDefinition` 对象的完整 CRUD 操作。
    *   **UI**: 主从布局，详情面板内使用 Tab 选项卡（基本信息、模型配置、接口）来组织复杂的配置项。
    *   **核心特性**:
        1.  **级联选择**: “模型”下拉菜单的内容会根据“连接”下拉菜单的选择而动态变化，这是数据联动的直接体现。
        2.  **组件复用**: 复用了 `TagsInput` 组件来管理标签。
        3.  **动态接口**: 为 Agent 的输入/输出提供动态增删的列表编辑器。

*   **`WorkflowManager` (工作流管理)**
    *   **功能**: 提供对 `WorkflowDefinition` 对象的 CRUD 操作，并提供一个可视化的编排画布。
    *   **依赖**: 强依赖 `LiteGraph.js` 库。
    *   **核心特性**:
        1.  **动态节点注册**: `registerNodeTypes` 方法会根据传入的 `Agent` 列表，动态地将每个 Agent 注册为画布上可用的一个节点。这使得工作流的能力可以随着 Agent 的增减而自动扩展。

#### 3. 数据结构 (`types.js`)

重构后的数据结构更加清晰和规范化：

*   `ProviderConnection`: 增加了 `availableModels: {id: string, name: string}[]` 字段，这是级联选择的数据基础。
*   `AgentDefinition`: `config` 对象被重构为 `{ connectionId, modelName, ... }`，彻底解决了之前数据模型的歧义性问题。

---


# #llm/settings-ui

> 一个全面、模块化、可组合的 LLM 应用设置界面。

`#llm/settings-ui` 提供了一个即用型、与框架无关的 UI 组件，用于管理 LLM 应用的所有核心方面。它使用户能够处理 API 连接、构建可重用的智能体，并可视化地编排复杂、**可组合的工作流**——所有这些都来自一个统一的界面。

 
*(演示 GIF/截图占位符)*

---

## 核心特性 (Key Features)

*   **🔌 连接管理 (Connection Management)**:
    *   对 LLM 服务提供商连接（API Keys, Base URLs）进行完整的 CRUD 操作。
    *   内置连接测试功能，提供即时反馈。
    *   支持为每个连接自定义可用的模型列表。

*   **🤖 智能体编辑器 (Agent Editor)**:
    *   通过清晰的 Tab 界面创建和管理可复用的、原子化的 LLM 调用单元 (Agents)。
    *   通过级联下拉菜单，为 Agent 精确指定 `Connection` 和 `Model`。
    *   动态定义 Agent 的输入/输出接口，使其成为工作流中的标准组件。
    *   支持标签、图标和描述，便于组织和查找。

*   **🌀 可组合的工作流 (Composable Workflows)**:
    *   基于 [LiteGraph.js](https://github.com/jagenjo/litegraph.js) 的可视化拖拽式工作流编辑器。
    *   **统一接口**: 工作流 (Workflow) 与智能体 (Agent) 共享相同的标准输入/输出接口，使它们可以**互换使用**。
    *   **无限嵌套**: 任何已创建的工作流都可以作为一个独立的节点，被拖拽到其他更复杂的工作流中，实现真正的模块化和可组合性。
    *   自动将所有已定义的 Agents 和 Workflows 注册为画布上的可用节点。

*   **💾 即插拔式持久化**:
    *   **开箱即用**: 无需配置，所有设置默认通过 `LocalStorage` 自动保存。
    *   **深度定制**: 通过注入自定义的 `IConfigService` 接口实现，可轻松对接任何后端数据库。

*   **🔧 卓越的架构设计 (Superior Architecture)**:
    *   **依赖倒置**: 核心业务逻辑（如 API 请求、通知）通过回调函数注入，使 UI 库与宿主应用完全解耦。
    *   **单向数据流**: 状态管理清晰、可预测，易于调试和扩展。
    *   **模块化与解耦**: UI 与数据持久化完全分离，可与任何存储后端（LocalStorage, IndexedDB, 远程服务器）集成。

*   **🧩 轻松集成 (Easy Integration)**:
    *   零框架依赖（核心库为原生 JavaScript），可轻松嵌入任何 React, Vue, Svelte 或原生 JS 项目。
    *   通过 "Extension Slots" 模式（已移除，简化为直接的 Tab 管理），可以轻松将您自己应用的设置页面无缝集成进来。（注：根据最新代码，此特性已简化为更直接的顶层 Tab 管理，如需扩展可直接修改 `_renderShell`）

## 架构概览 (Architecture Overview)

本库遵循**组件化**、**依赖倒置**和**单向数据流**的设计哲学，并引入了**统一可执行单元 (Unified Runnable)** 的核心抽象。

1.  **统一可执行单元 (Runnable)**: `Agent` 和 `Workflow` 都被抽象为“Runnable”。它们都拥有标准的、定义清晰的输入/输出接口，这使得一个复杂的 `Workflow` 可以像一个简单的 `Agent` 一样被调用、替换和组合。

2.  **`SettingsManagerUI` (协调器)**: 作为主入口，负责渲染整体布局，并从 `StorageAdapter` 加载和保存数据。它是状态管理的中心枢纽，负责在各组件间同步数据。

3.  **子组件 (`LibrarySettings`, `AgentEditor`, `WorkflowManager`)**: 每个组件管理一块独立的业务功能。它们通过 `props` 接收数据，并通过回调函数将变更**上报**给协调器。

4.  **`StorageAdapter` (存储适配器)**: 这是一个由您自己实现的接口。它告诉 UI 库如何读写数据，从而将 UI 与数据层完全解耦。

5.  **回调注入 (Callback Injection)**: 核心业务逻辑，如测试 API 连接或运行工作流，通过 `onTestConnection` 和 `onWorkflowRun` 等回调函数注入，使 UI 库保持通用性，易于测试。

## 快速开始 (Quick Start)

#### 1. HTML 设置

您需要在页面中引入 `LiteGraph.js` 的依赖，并创建一个用于挂载 UI 的容器。

```html
<!DOCTYPE html>
<html>
<head>
    <!-- LiteGraph.js 依赖 -->
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/gh/jagenjo/litegraph.js/css/litegraph.css">
    <script type="text/javascript" src="https://cdn.jsdelivr.net/gh/jagenjo/litegraph.js/build/litegraph.min.js"></script>
</head>
<body>
    <!-- UI 挂载点 -->
    <div id="settings-container" style="width: 95vw; height: 95vh;"></div>

    <script type="module" src="your-app.js"></script>
</body>
</html>
```

#### 2. JavaScript 初始化

##### 简单用法 (使用默认的 LocalStorage 存储)

```javascript
import { SettingsManagerUI } from '#llm/settings-ui';

async function main() {
    const container = document.getElementById('settings-container');

    // 直接创建实例，无需提供 configService
    const settingsUI = await SettingsManagerUI.create(container, {
        mode: 'page',
        // 业务逻辑回调仍然需要您自己提供
        onTestConnection: async (conn) => { /* ... 你的测试逻辑 ... */ },
        onWorkflowRun: (wf) => { console.log('Running:', wf.name); }
    });
}
main();
```
> ✨ **会发生什么？** 在这个配置下，用户在设置界面中创建的所有 Connections, Agents 和 Workflows 都会被自动保存在浏览器的 LocalStorage 中。

##### 高级用法 (注入自定义存储服务)

```javascript
import { SettingsManagerUI } from '#llm/settings-ui';
import { MyBackendConfigService } from './my-backend-config-service.js';

async function main() {
    const container = document.getElementById('settings-container');

    // 实例化你自己的服务
    const myConfigService = new MyBackendConfigService({ /* ... */ });

    const settingsUI = await SettingsManagerUI.create(container, {
        // 注入你的服务实现
        configService: myConfigService,
        mode: 'page',
        onTestConnection: async (conn) => { /* ... */ },
        onWorkflowRun: (wf) => { /* ... */ }
    });
}

main();
```

---

## API 参考

### `SettingsManagerUI.create(element, options)`

静态工厂方法，用于异步创建和初始化 UI 实例。

*   `element` (`HTMLElement`): 挂载 UI 的 DOM 容器。
*   `options` (`object`): 配置对象。

#### `options` 详解

| 属性 | 类型 | 必需? | 描述 |
| --- | --- | --- | --- |
| `configService` | `IConfigService` | 否 | 用于持久化配置的服务。**默认为 `DefaultConfigService` (使用 LocalStorage)。** |
| `mode` | `'page' \| 'modal'` | 否 | UI 的显示模式。默认为 `'modal'`。 |
| `onWorkflowRun` | `(wf) => void` | 否 | 当用户点击工作流运行按钮时触发的回调。 |
| `onTestConnection`| `(conn) => Promise<...>`| 否 | 当用户点击连接测试按钮时触发的回调。 |
| `onNotify` | `(msg, type) => void`| 否 | 用于显示非阻塞式通知的回调。 |

---
## 架构理念

本库遵循**依赖于抽象**的设计哲学。
1.  **`IConfigService` 接口**: 定义了所有配置数据（Connections, Agents, Workflows）的读写契约。
2.  **`DefaultConfigService`**: 提供了一个基于 `LocalStorage` 的默认实现，实现了“开箱即用”。
3.  **依赖注入**: `SettingsManagerUI` 接收一个 `IConfigService` 的实例。这使得 UI 组件与数据存储的实现方式完全解耦，您可以轻松地换用 IndexedDB、REST API 或任何其他后端。


## 扩展性 (Extensibility)

您可以通过 `customSettingsTabs` 选项来添加自己的设置页面。

每个 `CustomSettingsTab` 对象包含：
*   `id` (`string`): 唯一的 Tab ID。
*   `label` (`string`): 显示在 Tab 上的文本。
*   `onRender` (`(container: HTMLElement) => void`): 一个回调函数，当 Tab 被渲染时调用，您可以在 `container` 元素中渲染任何内容。

**示例:**

```javascript
const customTabs = [
    {
        id: 'appearance',
        label: 'Appearance',
        onRender: (container) => {
            container.innerHTML = '<h3>Theme Settings</h3><p>Choose your theme...</p>';
            // 在这里添加您的主题切换逻辑
        }
    }
];

// 初始化时传入
await SettingsManagerUI.create(container, {
    // ...其他选项
    customSettingsTabs: customTabs
});
```

## 核心数据结构 (Core Data Structures)

理解这些数据结构对于正确使用 `StorageAdapter` 至关重要。

#### `ProviderConnection`

```typescript
type ProviderConnection = {
  id: string;               // 唯一ID, e.g., "conn-12345"
  name: string;             // 用户友好的名称, e.g., "My OpenAI Key"
  provider: string;         // 提供商类型, e.g., "openai"
  apiKey: string;
  baseURL?: string;         // 可选的 API 端点
  availableModels: {        // 该连接下可用的模型列表
    id: string;             // 模型ID, e.g., "gpt-4o"
    name: string;           // 显示名称, e.g., "GPT-4 Omni"
  }[];
};
```

#### `AgentDefinition`

```typescript
type AgentDefinition = {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  tags?: string[];
  config: {
    connectionId: string;   // 关联的 ProviderConnection ID
    modelName: string;      // 使用的模型 ID (来自 connection.availableModels)
    systemPrompt?: string;
    // ...其他 LLM 参数
  };
  interface: {
    inputs: { name: string, type: string, description?: string }[];
    outputs: { name: string, type: string, description?: string }[];
  };
};
```

#### `WorkflowDefinition`

```typescript
type WorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  interface: { // 与 AgentDefinition 拥有相同的接口结构
    inputs: { name: string, type: string, description?: string }[];
    outputs: { name: string, type: string, description?: string }[];
  };
  nodes: WorkflowNode[];   // LiteGraph 节点数组
  links: WorkflowLink[];   // LiteGraph 连接数组
};
```

## 授权 (License)

MIT
