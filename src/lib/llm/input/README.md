

# LLMInputUI - 零依赖、功能丰富的 LLM 聊天输入框组件

<div align="center">
  <!-- 建议您在这里放置一张动态的 GIF 截图，展示组件的核心交互，如命令补全、文件上传等 -->
  <img src="https://path-to-your/screenshot.gif" alt="LLMInputUI 功能演示" width="800"/>
</div>

<br>

**LLMInputUI** 是一个独立的、零外部依赖的前端UI组件，专为与大语言模型（LLM）进行丰富的交互而设计。它提供了一个功能强大、高度可定制且易于集成的聊天输入框，可以无缝嵌入任何Web项目中。

无论您是在构建一个复杂的AI应用，还是一个简单的聊天机器人，LLMInputUI 都能为您提供开箱即用的解决方案，显著提升开发效率和用户体验。

---

## 📚 在线演示 (Live Demo)

百闻不如一见。我们强烈建议您通过在线 Playground 体验所有功能：

➡️ [**点击这里访问在线演示**](https://path-to-your-demo/demo.html) <!-- 请替换为您的 demo.html 部署地址 -->

---

## ✨ 核心特性

-   **🚀 零依赖**: 使用原生 JavaScript ES Module 编写，无需任何前端框架（如 React, Vue, Angular），可以轻松集成到任何技术栈中。
-   **🎨 高度可定制的主题**: 通过 CSS 变量，您可以轻松修改颜色、圆角、字体等，以匹配您的应用风格。
-   **🌍 国际化 (i18n)**: 所有UI文本均可配置，轻松支持多语言。
-   **⌨️ 强大的命令系统**: 内置 `/` 和 `@` 命令支持，并提供 API 动态注册您自己的自定义命令。全程配有便捷的自动补全弹窗。
-   **📎 多模态输入与附件处理**: 支持文件点选、拖放上传、剪贴板粘贴图片。可配置附件类型、大小和数量限制。
-   **🔔 事件驱动架构**: 提供丰富的事件钩子 (如 `attachmentAdd`, `commandExecute`)，让您可以监听并响应组件内部的各种行为。
-   **♿ 无障碍访问 (A11y)**: 为关键交互元素提供了 ARIA 属性和完整的键盘导航支持，确保所有用户都能顺畅使用。
-   **📱 移动端友好**: 响应式设计，在桌面和移动设备上均有良好表现。
-   **🔄 动态状态管理**: 发送按钮会根据输入内容和加载状态，在“发送”和“停止”之间动态切换，并自动处理禁用/启用状态。
-   **👁️ 上下文清晰可见**: 简洁的状态栏会清晰展示当前对话所选的模型和任何被强制指定的工具。

---

## 🚀 快速开始

### 1. 安装

您可以直接下载 `input-ui` 目录并放置到您的项目中。

```
/your-project
└── /src
    └── /lib
        └── /llm-kit
            └── /input-ui
                ├── index.js
                └── ... (其他模块文件)
```
在您的 HTML 文件中，通过 `<script type="module">` 引入您的主脚本。

```html
<script type="module" src="/path/to/your/main-script.js"></script>
```

### 2. HTML 结构

在您的 HTML 文件中，创建一个用于承载输入 UI 的容器元素。

```html
<div id="chat-input-container"></div>
```

### 3. JavaScript 初始化

在您的主脚本中，导入 `LLMInputUI` 类并实例化。其中，最重要的选项是 `onSubmit` 回调函数。

```javascript
import { LLMInputUI } from './#llm/input/index.js';

// 1. 获取容器元素
const inputContainer = document.getElementById('chat-input-container');

// 2. (可选) 定义您的 LLM 可以使用的工具列表
const availableTools = [{
    type: 'function',
    function: {
        name: 'get_current_weather',
        description: '获取指定地点的当前天气',
        parameters: { type: 'object', properties: { location: { type: 'string' } } },
    },
}];

// 3. 创建 UI 实例
const inputUI = new LLMInputUI(inputContainer, {
    // [必需] 当用户点击发送时，此函数将被调用
    onSubmit: async (data) => {
        console.log('提交的数据:', data);
        // data 的结构如下:
        // { 
        //   text: "东京的天气怎么样？", 
        //   attachments: [File, ...],
        //   model: "gemini-1.5-pro",
        //   toolChoice: { type: 'function', function: { name: 'get_current_weather' } }, // 如果用户使用了 @ 命令
        //   systemPrompt: "你是一个乐于助人的助手。" // 如果用户使用了 /system 命令
        // }
        
        // 步骤 A: 让 UI 进入加载状态
        inputUI.startLoading();

        try {
            // 步骤 B: 调用您的 LLM 库 (例如 llm-fusion-kit)
            const response = await myLlmClient.chat.create({ messages: [...] });
            // 处理 LLM 的响应...
        } catch (error) {
            // 处理错误...
            inputUI.showError(`请求失败: ${error.message}`);
        } finally {
            // 步骤 C: 无论成功或失败，都结束 UI 的加载状态
            inputUI.stopLoading();
        }
    },
    
    // [可选] 传入其他配置
    tools: availableTools,
    initialModel: 'deepseek-reasoner',
    localization: {
      placeholder: '输入消息，或使用 / 和 @ 命令...'
    }
});
```

---

## 🛠️ API 参考

### 构造函数 `new LLMInputUI(element, options)`

#### `element`
*   **类型**: `HTMLElement`, **必需**
*   **描述**: 用于渲染输入框组件的容器DOM元素。

#### `options`
*   **类型**: `Object`, **必需**
*   **描述**: 一个包含所有配置的对象。

### 配置选项 (Options)

| 选项名 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `onSubmit` | `function` | **必需** | 用户提交时触发的回调函数。接收一个包含 `{ text, attachments, ... }` 的数据对象。 |
| `initialModel`| `string` | `''` | 初始显示的 LLM 模型名称。 |
| `initialText` | `string` | `''` | 输入框的初始文本内容。 |
| `tools` | `Array<Object>` | `[]` | 用于 `@` 命令提示的工具列表，遵循 OpenAI tool 格式。 |
| `disableAttachments`| `boolean` | `false` | 如果为 `true`，将禁用所有附件相关功能。 |
| `attachments` | `Object` | `{...}` | 附件验证配置。包含 `maxSizeMB`, `maxCount`, `mimeTypes`。 |
| `localization`| `Object` | `{...}` | 用于国际化的文本字符串。 |
| `theme` | `Object` | `{...}` | 用于主题化的 CSS 变量键值对。 |
| `classNames` | `Object` | `{...}` | 为组件各部分指定自定义 CSS 类名，用于深度样式定制。 |
| `on` | `Object` | `{}` | 事件监听器回调函数的集合。 |


### 公共方法 (Public Methods)

在实例化 `LLMInputUI` 后，您可以调用其实例上的以下方法来控制组件。

| 方法 | 参数 | 描述 |
| --- | --- | --- |
| `startLoading()` | - | 显示加载状态（发送按钮变为停止图标）。 |
| `stopLoading()` | - | 停止加载状态。 |
| `clear()` | - | 清空输入框文本和所有附件。 |
| `setModel(modelName)` | `string` | 动态设置状态栏上显示的模型名称。 |
| `setTheme(themeOptions)`| `Object` | 动态更新组件的主题（CSS变量）。 |
| `showError(message)` | `string` | 在输入框上方显示一条错误信息。 |
| `registerCommand(cmd)` | `Object` | 动态注册一个新的 `/` 命令。 |

### 事件 (Events)

您可以通过 `options.on` 对象来监听组件生命周期中的各种事件。

| 事件名 | 载荷 (Payload) | 触发时机 |
| --- | --- | --- |
| `beforeAttachmentAdd`| `Object` | 文件被添加到状态前。返回`false`可取消。|
| `attachmentAdd` | `Object` | 文件成功添加到状态后。 |
| `attachmentRemove`| `Object` | 附件被移除后。 |
| `commandExecute`| `{command, value}`| 一个 `/` 命令被成功执行后。 |
| `modelChange` | `string` | 调用 `setModel()` 时。 |
| `themeChange` | `Object`| 调用 `setTheme()` 时。 |
| `error` | `Error` | `onSubmit` 回调中抛出异常时。 |
| `stopRequested` | - | 在加载状态下点击发送（停止）按钮时。 |
| `clear` | - | 调用 `clear()` 时。 |

---

## 💡 高级用法示例

### 1. 动态切换主题
```javascript
const inputUI = new LLMInputUI(container, { onSubmit });

const darkModeTheme = {
    '--llm-bg-color': '#2d2d2d',
    '--llm-border-color': '#555',
    '--llm-text-color': '#f0f0f0',
    '--llm-input-bg-color': '#3c3c3c',
    '--llm-primary-color': '#58a6ff'
};

// 监听按钮点击，切换到暗黑模式
document.getElementById('dark-mode-btn').addEventListener('click', () => {
    inputUI.setTheme(darkModeTheme);
});
```

### 2. 注册自定义命令
```javascript
const inputUI = new LLMInputUI(container, { onSubmit });

// 注册一个 /timestamp 命令，点击提示后只填充，不执行
inputUI.registerCommand({
    name: '/timestamp',
    description: '在输入框中插入当前时间戳。',
    // handler 的 `this` 指向 inputUI 实例
    handler() {
        this.elements.textarea.value += Date.now();
        this._updateUIState();
    },
    executeOnClick: false 
});

// 注册一个 /random 命令，点击提示后立即执行
inputUI.registerCommand({
    name: '/random',
    description: '生成一个随机数并显示。',
    handler() {
        this._showToast(`随机数: ${Math.round(Math.random() * 100)}`);
        this.clear();
    },
    executeOnClick: true 
});
```
---

## 🤝 贡献指南

我们欢迎任何形式的贡献！如果您发现了一个bug，或者有功能建议，请随时提交一个 [Issue](https://link-to-your-repo/issues)。如果您希望贡献代码，请 Fork 本仓库并发起一个 Pull Request。

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源。