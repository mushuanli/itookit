# @llm-kit/historyUI

一个功能全面、可扩展的 LLM 对话历史 UI 组件，使用原生 JavaScript 构建。

## ✨ 功能特性

- ✅ **消息对管理** - 统一管理用户与助手的对话配对
- ✅ **流式传输支持** - 通过 SSE 实现实时流式响应，并进行节流渲染
- ✅ **编辑与重发** - 编辑任意历史消息，创建对话分支
- ✅ **锁定机制** - 在 AI 生成期间禁用交互，保证状态安全
- ✅ **思考过程展示** - 可折叠的思考/推理过程显示
- ✅ **多智能体支持** - 在不同的 AI 智能体之间切换
- ✅ **附件支持** - 发送图片、文件等多媒体内容
- ✅ **MDxEditor 集成** - 完整的 Markdown 编辑与渲染能力
- ✅ **插件系统** - 可通过插件轻松扩展功能
- 🆕 **上下文管理** - 支持多种上下文截断策略，节约 Token
- 🆕 **历史搜索** - 内置对话历史搜索、高亮与导航功能

## 📦 安装

```bash
npm install @llm-kit/historyui
```

## 🚀 快速开始

```javascript
import { createHistoryUI } from '@llm-kit/historyUI';
import { LLMClient } from '#llm/history/client/LLMClient.js'; // 假设你有一个 LLMClient

// 创建 UI 实例
const historyUI = createHistoryUI(document.getElementById('container'), {
    llmClient: new LLMClient({
        apiUrl: '/api/chat/stream'
    })
});

// 添加一条消息
const pair = historyUI.addPair('你好！');

// 发送给 LLM
await historyUI.sendMessage(pair);
```

## 📚 API 参考

### LLMHistoryUI

#### 主要方法 (Methods)

- `addPair(userContent, assistantContent?, options?)` - 添加一个新的消息对。
- `deletePair(pairId)` - 删除一个指定的消息对。
- `editAndResend(pairId, newContent, newAgent?)` - 编辑用户消息并从该点重新生成对话。
- `sendMessage(pair)` - 将指定的消息对发送给 LLM 进行流式生成。
- `lock()` / `unlock()` - 手动锁定或解锁 UI。
- `loadHistory(data)` - 从 JSON 对象加载完整的对话历史。
- `exportHistory()` - 将当前对话历史导出为 JSON 对象，便于持久化存储。
- `clear()` - 清空所有对话历史，开始新会话。

---

- 🆕 `search(keyword)` - 搜索对话历史。返回匹配关键词的消息对 ID 数组。
- 🆕 `nextResult()` / `previousResult()` - 在搜索结果之间向上或向下导航。
- 🆕 `clearSearch()` - 清除搜索状态和高亮。

#### 事件 (Events)

`LLMHistoryUI` 基于 EventEmitter 构建，提供了丰富的事件通知机制，便于开发者构建自动保存等功能。

- `pairAdded` - 当一个消息对被添加时触发。
- `pairDeleted` - 当一个消息对被删除时触发。
- `assistantMessageDeleted` - 当助手的回复被单独删除时触发。
- `messageResent` - 当一条消息被编辑并重发后触发。
- `branchSwitched` - 当切换到不同的对话分支后触发。
- `messageComplete` - 当 LLM 的流式响应成功完成后触发。**这是实现自动保存的最佳时机**。
- `locked` / `unlocked` - 当 UI 锁定状态改变时触发。
- `streamError` - 当流式传输发生错误时触发。
- `historyCleared` - 当调用 `clear()` 清空历史后触发。
- `historyLoaded` - 当调用 `loadHistory()` 加载历史后触发。

### 客户端 (LLMClient)

你可以实现自己的客户端，或使用我们提供的基类。

```javascript
class MyLLMClient extends LLMClient {
    async *sendStream(payload) {
        // 在这里实现你自己的流式请求逻辑
        // 需要 yield: { type: 'thinking'|'content'|'done', content } 格式的对象
    }
}
```

## 🌟 高级用法

### 上下文管理策略

为了节省 Token 成本并避免超出上下文长度限制，你可以在创建实例时配置上下文管理策略。

#### 方式一：使用内置策略 (简单)

只发送最近的 10 条消息（即 5 组对话）给 LLM。

```javascript
const historyUI = createHistoryUI(container, {
    llmClient: client,
    contextStrategy: 'lastN',
    contextWindowSize: 10 
});
```

#### 方式二：使用自定义函数 (灵活)

提供一个 `contextBuilder` 函数，完全自定义发送给 LLM 的上下文内容。

```javascript
function myCustomContextBuilder(allPairs) {
    const messages = [];
    // 在这里实现你的摘要 + 最近 N 条等复杂逻辑
    const recentPairs = allPairs.slice(-3); // 取最近3组
    recentPairs.forEach(pair => {
        messages.push({ role: 'user', content: pair.userMessage.content });
        if (pair.assistantMessage.content) {
            messages.push({ role: 'assistant', content: pair.assistantMessage.content });
        }
    });
    return messages;
}

const historyUI = createHistoryUI(container, {
    llmClient: client,
    contextBuilder: myCustomContextBuilder
});
```

## 🧩 插件系统

### 内置插件

- **ThinkingPlugin** - 支持“思考过程”的展示。
- **AttachmentPlugin** - 提供文件和图片附件功能。

### 自定义插件

你可以轻松编写自己的插件来扩展功能。

```javascript
class MyPlugin {
    install(historyUI) {
        // 监听组件事件，添加自定义逻辑
        historyUI.on('pairAdded', ({ pair }) => {
            console.log('A new pair was added:', pair.id);
        });
    }
}

// 使用插件
historyUI.use(new MyPlugin());
```

## 📄 许可证

MIT
