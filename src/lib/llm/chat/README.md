好的，这是为 `LLMChatUI` 组件生成的 `README.md` 文件。它详细介绍了核心功能、架构优势以及我们刚刚实现的所有高级命令。

---

# @llm-kit/chat-ui - 终极 LLM 聊天界面解决方案

<div align="center">
  <!-- 建议您在这里放置一张动态的 GIF 截图，展示组件的整体交互效果 -->
  <img src="https://path-to-your/chat-ui-demo.gif" alt="LLMChatUI 完整功能演示" width="800"/>
</div>

<br>

**@llm-kit/chat-ui** 是一个功能完备、高度可扩展的 LLM 聊天界面组件。它通过优雅地组合 `@llm-kit/history-ui` 和 `@llm-kit/input-ui` 这两个强大的子模块，提供了一个开箱即用的、企业级的聊天解决方案。

该组件的设计哲学是**“依赖于抽象，而非具体实现”**。它作为一个智能的**协调器（Orchestrator）**，将用户输入、对话历史展示、与LLM的通信、高级工作流以及**数据持久化**无缝地整合在一起，同时保持了底层模块的独立性和可复用性。

---

## 🌟 核心特性

-   **🧩 模块化架构**: 完美集成 `history-ui` 和 `input-ui`，职责清晰，易于维护。
-   **💾 即插拔式持久化**:
    *   **开箱即用**: 无需任何配置，聊天记录默认通过 `LocalStorage` 自动保存。
    *   **深度定制**: 通过注入自定义的 `ISessionStorageService` 和 `IFileStorageAdapter` 接口实现，可轻松对接任何后端数据库或云存储。
-   **🔌 灵活的模型配置**: 通过 `connections` 和 `agents` 数组进行配置，轻松支持多模型、多提供商切换。
-   **🌊 完整的流式响应**: 支持端到端的流式生成，提供极致的响应体验。
-   **⌨️ 超级命令面板**: 内置强大的 `/` 命令系统，极大地提升交互效率（详见下文）。
-   **🖼️ 丰富的多模态支持**: 支持文件上传、拖拽和粘贴，并在对话历史中完美展示。
-   **🔄 健壮的状态管理**: 精心设计的状态流转，确保各种情况下UI表现一致且可靠。
-   **🎨 深度主题定制**: 通过 CSS 变量轻松打造符合您品牌风格的聊天界面。
-   **🔍 对话历史高级操作**: 支持对话分支切换、历史搜索、消息编辑与重新生成等。

---

## 🚀 快速开始

### 1. HTML 结构

在您的 HTML 文件中，创建一个用于承载完整聊天界面的容器。

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLMChatUI Demo</title>
    <!-- Font Awesome for icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
        html, body, #chat-app {
            height: 100%;
            margin: 0;
            font-family: sans-serif;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div id="chat-app"></div>
    <script type="module" src="app.js"></script>
</body>
</html>
```

### 2. JavaScript 初始化

#### 简单用法 (使用默认的 LocalStorage 存储)

这是最快的上手方式。您只需要提供模型配置和会话ID。

```javascript
import { LLMChatUI } from './#llm/chat/index.js';

const chatContainer = document.getElementById('chat-app');

// 1. 定义你的服务连接和智能体
const myConnections = [
    {
        id: 'openai_default',
        provider: 'openai',
        apiKey: 'YOUR_OPENAI_API_KEY',
    }
];

const myAgents = [
    {
        id: 'gpt-4o-agent',
        name: 'GPT-4 Omni',
        icon: '🤖',
        config: {
            connectionId: 'openai_default',
            modelName: 'gpt-4o',
        }
    },
    // 你可以定义更多 agent，例如使用不同的模型或系统提示
];

// 2. 实例化 LLMChatUI
const chatApp = new LLMChatUI(chatContainer, {
    // 核心配置
    connections: myConnections,
    agents: myAgents,
    initialAgent: 'gpt-4o-agent', // 默认选中的 Agent ID

    // 持久化配置
    sessionId: 'my-unique-chat-session-123', // 必需，用于区分不同的聊天
    // `sessionStorage` 和 `fileStorage` 未提供，将自动使用默认实现
    
    // UI 子模块配置 (可选)
    inputUIConfig: {
        initialModel: 'gpt-4o',
        tools: [
            // 在这里定义你的工具，用于 @ 命令提示
            // { type: 'function', function: { name: 'get_weather', ... } }
        ],
        // 定义模板和角色
        templates: {
            'bug_report': '## Bug Report\n\n**Describe the bug:**\n\n**To Reproduce:**\n1. \n\n**Expected behavior:**\n',
            'summary': '## Weekly Summary\n\n**Accomplishments:**\n- \n\n**Next Week\'s Goals:**\n- '
        },
        personas: {
            'js_expert': 'You are a world-class JavaScript expert with 20 years of experience. Your answers are concise, accurate, and follow best practices.',
            'creative_writer': 'You are a creative writer. Your goal is to produce imaginative and engaging stories.'
        },
        // 实现 onTemplateSave 以支持 /save 命令
        on: {
            templateSave: ({ name, content }) => {
                console.log(`Saving template "${name}"...`);
                // 实现你的存储逻辑，例如使用 localStorage
                localStorage.setItem(`template_${name}`, content);
            }
        }
    },

    // 3. 对话历史 (history-ui) 的配置 (如果需要)
    historyUIConfig: {
        // 例如，配置可用的 Agent 列表
        agents: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
        ]
    }
});
```
> ✨ **会发生什么？** 在这个配置下，所有的聊天记录都会被自动保存在浏览器的 LocalStorage 中。刷新页面后，对话将自动恢复。

#### 高级用法 (注入自定义存储服务)

如果您需要将数据存储到自己的后端数据库，只需实现相应的服务接口并注入即可。

```javascript
// 假设你已经根据 @common/store/ 的接口定义实现了自己的服务
import { MyBackendSessionStorage } from './my-backend-storage.js';
import { MyCloudFileStorage } from './my-cloud-storage.js';

const chatApp = new LLMChatUI(chatContainer, {
    connections: myConnections,
    agents: myAgents,
    initialAgent: 'gpt-4o-agent',
    sessionId: 'user123-session-abc',

    // 注入你自己的实现
    sessionStorage: new MyBackendSessionStorage({ userId: 'user123' }),
    fileStorage: new MyCloudFileStorage({ authToken: '...' }),
});
```

---

## 🛠️ API 与配置

`new LLMChatUI(element, options)`

-   `element` (`HTMLElement`): 承载UI的容器。
-   `options` (`Object`): 配置对象。

#### `options` 详解

| 属性 | 类型 | 必需? | 描述 |
| --- | --- | --- | --- |
| `connections` | `ProviderConnection[]` | **是** | 定义所有可用的 LLM 服务连接。 |
| `agents` | `AgentDefinition[]` | **是** | 定义所有可用的智能体（模型、系统提示等的组合）。 |
| `sessionId` | `string` | **是** | 当前聊天会话的唯一标识符，用于持久化。 |
| `initialAgent` | `string` | 否 | 初始时默认选中的 Agent 的 ID。 |
| `sessionStorage`| `ISessionStorageService`| 否 | 用于持久化聊天记录的服务。**默认为 `LLMSessionStorageService` (使用 LocalStorage)。** |
| `fileStorage` | `IFileStorageAdapter` | 否 | 用于处理文件上传的服务。**默认为 `FileStorageAdapter` (仅本地预览)。** |
| `inputUIConfig` | `Object` | 否 | 传递给 `LLMInputUI` 实例的配置。 |
| `historyUIConfig`| `Object` | 否 | 传递给 `LLMHistoryUI` 实例的配置。 |

---

## 💡 高级功能：强大的命令系统

通过输入框中的 `/` 命令，您可以极大地提升交互效率。

### 效率与工作流 (Efficiency & Workflow)

| 命令 | 示例 | 描述 |
| --- | --- | --- |
| `/template` | `/template bug_report` | **插入模板**：将预定义的文本模板（在`inputUIConfig.templates`中配置）插入到输入框中，非常适合结构化输入。 |
| `/save` | `/save my_prompt` | **保存为模板**：将当前输入框中的长文本保存为一个新的模板，以便将来通过 `/template` 命令快速调用。需要实现 `on.templateSave` 回调。 |
| `/last` | `/last summarize` <br> `/last copycode` | **操作上一条回答**：对AI的最后一条回复执行操作。`summarize` 会请求AI总结其回答，`copycode` 会自动复制回答中所有的代码块到剪贴板。 |

### 上下文与人格管理 (Context & Persona Management)

| 命令 | 示例 | 描述 |
| --- | --- | --- |
| `/persona` | `/persona js_expert` | **切换AI人格**：快速应用一个预定义的系统提示（在`inputUIConfig.personas`中配置），让AI以特定专家的身份回答问题，比 `/system` 更快捷。 |
| `/no_context` | `/no_context` | **无上下文发送**：发送下一条消息时，将不包含任何之前的对话历史。非常适合开启一个全新的、不受干扰的话题。 |
| `/system` | `/system 你是一个诗人` | **临时系统提示**：为下一次请求设置一个一次性的系统提示。 |
| `/model` | `/model claude-3-opus-20240229` | **切换模型**：临时为下一次请求切换语言模型。 |

### 历史与元数据 (History & Metadata)

| 命令 | 示例 | 描述 |
| --- | --- | --- |
| `/export` | `/export` | **导出历史**：将当前的完整对话历史（包括分支信息）导出为一个 JSON 文件，便于备份和分享。 |
| `/search` | `/search "API key"` | **搜索对话**：在当前对话历史中高亮所有匹配的关键词，并自动滚动到第一个匹配项。 |
| `/clear` | `/clear` | **清空输入**：清空当前输入框的文本和所有附件。 |
| `/help` | `/help` | **显示帮助**：在输入框上方弹出一个包含所有可用命令及其描述的列表。 |

---

## 🏛️ 架构理念

`LLMChatUI` 的设计体现了现代前端开发的最佳实践：

1.  **依赖于抽象 (Dependency Inversion)**: 核心业务逻辑（如数据持久化）通过接口 (`ISessionStorageService`) 定义。UI 组件依赖于这些接口，而不是具体的实现。这使得存储后端可以轻松替换。
2.  **默认实现与覆盖 (Defaults and Overrides)**: 组件为关键服务提供了“开箱即用”的默认实现，大大降低了上手难度。同时，所有默认实现都可以被用户提供的自定义实现所覆盖，保证了终极的灵活性。
3.  **关注点分离 (SoC)**: `inputUI` 只关心“输入”，`historyUI` 只关心“展示与通信”。`LLMChatUI` 作为协调器，负责组装和管理它们之间的交互，职责清晰。
4.  **状态提升与单向数据流**: 跨组件的状态被提升到 `LLMChatUI` 进行管理。数据流是单向的，使得状态变化可预测，避免了混乱的状态同步问题。

这种架构不仅使 `LLMChatUI` 本身成为一个强大的聚合器，也保证了其子模块 `@llm-kit/input-ui` 和 `@llm-kit/history-ui` 可以被单独拿出，在其他不同的场景中独立复用。

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源。
