
### 第一部分：更新 `README.md`

这份 README 旨在吸引开发者，让他们在 30 秒内理解项目的核心价值，并在 5 分钟内上手使用其高级功能。

```markdown
# LLM Fusion Kit

**一个统一、强大且可扩展的客户端，用于与多模态大语言模型（LLM）进行交互。**

[![NPM Version](https://img.shields.io/npm/v/llm-kit.svg)](https://www.npmjs.com/package/llm-kit)
[![License](https://img.shields.io/npm/l/llm-kit.svg)](https://github.com/your-username/llm-kit/blob/main/LICENSE)

---

`llm-kit` 旨在解决与多个 LLM 提供商交互时的复杂性和不一致性。它提供了一个类似 OpenAI SDK 的优雅接口，同时原生支持多模态输入、工具调用和简单的任务编排，让您能专注于构建下一代 AI 应用，而不是处理繁琐的 API 适配。

### ✨ 核心特性

*   **统一的 API**: 学习一次，随处使用。`client.chat.create` 接口与 `openai` 库高度兼容，迁移成本极低。
*   **多提供商支持**: 即时访问 OpenAI, Google Gemini, DeepSeek, OpenRouter 等，轻松切换模型以获得最佳性能和成本。
*   **多模态原生**: 无缝处理文本、图片附件。强大的文件处理器可在浏览器（File, Blob）和 Node.js（Buffer, URL）环境中自动转换附件。
*   **流式响应**: 通过简单的 `for await...of` 循环，轻松处理流式响应，打造实时交互体验。
*   **工具调用 (Function Calling)**: 内置标准化的工具调用支持，使您的 LLM 能够与外部 API 和函数交互，构建强大的智能体（Agent）。
*   **简单编排 (`LLMChain`)**: 使用流式 API `LLMChain` 轻松构建顺序任务，将一个 LLM 的输出作为下一个的输入。
*   **高度可扩展**: 通过自定义 Provider 和强大的钩子系统 (`beforeRequest`, `afterResponse`, `onError`)，轻松扩展和定制库的行为。
*   **同构设计**: 可在 Node.js 和浏览器环境中无缝运行。

### 📦 安装

```bash
npm install llm-kit
```

### 🚀 快速上手

在几行代码内开始您的第一次 LLM 调用。

```javascript
import { LLMClient } from 'llm-fusion-kit';

const client = new LLMClient({
  provider: 'openai', // or 'gemini', 'deepseek', 'openrouter'
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  try {
    const response = await client.chat.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '你好，世界！' }],
    });

    console.log(response.choices[0].message.content);
  } catch (error) {
    console.error('请求失败:', error);
  }
}

main();
```

---

### 🌟 高级用法

#### 1. 图像输入 (视觉能力)

发送文本和图像给多模态模型。`llm-fusion-kit` 会自动处理不同来源的图像。

```javascript
import fs from 'fs';

const imageBuffer = fs.readFileSync('./cat.jpg');

const response = await client.chat.create({
  model: 'gemini-1.5-pro-latest', // A model that supports vision
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '详细描述这张图片。' },
        { type: 'image_url', image_url: { url: imageBuffer } } // Supports Buffer, File, Blob, URL
      ],
    },
  ],
});

console.log(response.choices[0].message.content);
```

#### 2. 流式响应

实时获取模型的输出。

```javascript
const stream = await client.chat.create({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: '写一首关于代码的短诗。' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

#### 3. 工具调用 (Function Calling)

让 LLM 调用您的函数。

```javascript
// 1. 定义你的工具
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_current_weather',
      description: '获取指定地点的当前天气',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: '城市名，例如：北京' },
        },
        required: ['location'],
      },
    },
  },
];

// 2. 第一次调用，让模型决定是否使用工具
let messages = [{ role: 'user', content: '北京现在天气怎么样？' }];
const response = await client.chat.create({
  model: 'gpt-4o',
  messages,
  tools,
  tool_choice: 'auto',
});

const message = response.choices[0].message;

// 3. 检查模型是否请求调用工具
if (message.tool_calls) {
  messages.push(message); // 将模型的回复添加到历史中
  const toolCall = message.tool_calls[0];
  
  // 4. (在此处)执行您的函数
  // const weather = get_current_weather(toolCall.function.arguments);
  const toolResult = JSON.stringify({ temperature: '25°C', condition: '晴' });

  // 5. 将工具执行结果返回给模型
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: toolResult,
  });

  const finalResponse = await client.chat.create({
    model: 'gpt-4o',
    messages,
  });
  console.log(finalResponse.choices[0].message.content); // "北京目前天气晴朗，温度为 25°C。"
}
```

#### 4. 使用 `LLMChain` 编排任务

轻松地将多个 LLM 调用串联起来。

```javascript
import { LLMClient, LLMChain } from 'llm-fusion-kit';

const client = new LLMClient({ provider: 'openai', apiKey: '...' });
const chain = new LLMChain(client);

// 定义一个两步任务链
chain
  .add({
    promptTemplate: '为以下主题生成一个简短的摘要: {topic}',
    inputVariables: ['topic'],
    outputVariable: 'summary',
  })
  .add({
    promptTemplate: '将以下摘要翻译成法语: {summary}',
    inputVariables: ['summary'],
    outputVariable: 'french_summary',
  });

// 运行任务链
const result = await chain.run({ topic: '人工智能的历史' });

console.log(result.french_summary);
```

#### 5. 使用钩子

在请求生命周期的关键点注入自定义逻辑，例如日志记录或缓存。

```javascript
const client = new LLMClient({
  provider: 'openai',
  apiKey: '...',
  hooks: {
    beforeRequest: async (params) => {
      console.log(`[HOOK] 发送请求到模型: ${params.model}`);
      return params;
    },
    onError: async (error) => {
      console.error(`[HOOK] 请求失败: ${error.message}`);
    },
  },
});
```

### 📚 API 参考 (高级)

*   **`new LLMClient(config)`**: 创建客户端实例。
    *   `config.provider`: `string` - 'openai', 'gemini', etc.
    *   `config.apiKey`: `string`
    *   `config.model`: `string` (可选, 默认模型)
    *   `config.hooks`: `object` (可选, 生命周期钩子)
*   **`client.chat.create(params)`**: 发起聊天请求。
    *   `params.messages`: `Array<object>`
    *   `params.model`: `string`
    *   `params.stream`: `boolean`
    *   `params.temperature`, `params.max_tokens`, `params.top_p`: `number`
    *   `params.tools`, `params.tool_choice`: `object`
*   **`new LLMChain(client)`**: 创建任务链实例。
*   **`chain.add(stepConfig, llmConfig)`**: 添加一个步骤。
*   **`chain.run(initialContext)`**: 执行任务链。

### 🤝 贡献

我们欢迎所有形式的贡献！请随时提交 Pull Request 或创建 Issue。

### 📜 许可证

[MIT](./LICENSE)
