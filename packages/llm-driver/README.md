

## 4. 迁移清单

### 4.1 需要移动到 llm-kernel 的文件

| 原文件 | 新位置 | 说明 |
|--------|--------|------|
| `executors/agent-executor.ts` | `llm-kernel/executors/agent-executor.ts` | 重写，使用新接口 |
| `base/executor.ts` | `llm-kernel/core/types.ts` | 类型定义迁移 |

### 4.2 需要移动到 llm-engine 的文件

| 原文件 | 新位置 | 说明 |
|--------|--------|------|
| `services/VFSAgentService.ts` | `llm-engine/services/agent-service.ts` | 保持逻辑不变 |
| `services/IAgentService.ts` | `llm-engine/services/agent-service.ts` | 合并导出 |
| `engine/LLMSessionEngine.ts` | `llm-engine/persistence/session-engine.ts` | 保持逻辑不变 |
| `base/session/*` | `llm-engine/persistence/types.ts` | 类型迁移 |
| `base/agent.ts` | `llm-engine/types/agent.ts` | Agent 定义 |
| `base/config.ts` | `llm-engine/types/config.ts` | 配置定义 |

### 4.3 需要删除的文件

| 文件 | 原因 |
|------|------|
| `base/index.ts` | 重新组织导出 |
| `base/enginecore.ts` | 如果存在，已废弃 |

---

## 5. 重构后的完整 index.ts

```typescript
// @file: llm-driver/index.ts

/**
 * @package @itookit/llm-driver
 * @description 纯粹的 LLM 通信层
 * 
 * 职责：
 * - 封装各 LLM Provider 的 API 调用
 * - 统一消息格式和响应结构
 * - 处理流式响应
 * - 提供连接测试能力
 * 
 * 不包含：
 * - 执行逻辑 (→ @itookit/llm-kernel)
 * - 会话管理 (→ @itookit/llm-engine)
 * - 持久化 (→ @itookit/llm-engine)
 * - Agent 定义 (→ @itookit/llm-engine)
 */

// ============================================
// 核心类
// ============================================

export { LLMDriver } from './core/driver';
export { LLMChain } from './core/chain';
export { testLLMConnection, testMultipleConnections } from './core/api';
export type { ConnectionTestResult } from './core/api';

// ============================================
// 错误处理
// ============================================

export { LLMError, LLMErrorCode } from './errors';
export type { LLMErrorDetails } from './errors';

// ============================================
// 类型定义
// ============================================

// 连接配置
export type {
    LLMConnection,
    LLMModel,
    LLMProviderDefinition
} from './types/connection';

// 消息
export type {
    ChatMessage,
    MessageContent,
    MessageContentPart,
    MessageContentText,
    MessageContentImage,
    MessageContentDocument,
    Role,
    ToolCall,
    ToolDefinition
} from './types/message';

// Provider 配置
export type {
    LLMProviderConfig,
    LLMClientConfig,
    LLMHooks
} from './types/provider';

// 请求/响应
export type {
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk
} from './types/response';

// ============================================
// Provider 系统
// ============================================

export { BaseProvider } from './providers/base';
export { OpenAIProvider } from './providers/openai';
export { AnthropicProvider } from './providers/anthropic';
export { GeminiProvider } from './providers/gemini';

export {
    registerProvider,
    getProvider,
    createProvider,
    getRegisteredProviders,
    isProviderRegistered
} from './providers/registry';

// ============================================
// 常量
// ============================================

export {
    LLM_PROVIDER_DEFAULTS,
    LLM_DEFAULT_ID,
    DEFAULT_TIMEOUT,
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_DELAY,
    getProviderDefinition,
    getModelDefinition
} from './constants';

// ============================================
// 工具函数
// ============================================

export {
    processAttachment,
    isImageMimeType,
    isSupportedVisionContent,
    buildImageContent
} from './utils/attachment';

export {
    parseSSEStream,
    createCancellableStream,
    mergeStreams
} from './utils/stream';
```

---

## 6. 使用示例

### 6.1 基础使用

```typescript
import { LLMDriver } from '@itookit/llm-driver';

// 方式 1: 直接配置
const driver = new LLMDriver({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o'
});

// 方式 2: 使用 Connection 对象
const driver2 = new LLMDriver({
    connection: {
        id: 'my-connection',
        name: 'My OpenAI',
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-4o'
    }
});

// 非流式调用
const response = await driver.chat.create({
    messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' }
    ]
});

console.log(response.choices[0].message.content);
```

### 6.2 流式调用

```typescript
import { LLMDriver } from '@itookit/llm-driver';

const driver = new LLMDriver({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514'
});

const stream = await driver.chat.create({
    messages: [{ role: 'user', content: 'Write a poem about coding.' }],
    stream: true,
    thinking: true  // 启用思考过程
});

for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    
    if (delta?.thinking) {
        process.stdout.write(`[Thinking] ${delta.thinking}`);
    }
    
    if (delta?.content) {
        process.stdout.write(delta.content);
    }
}
```

### 6.3 连接测试

```typescript
import { testLLMConnection } from '@itookit/llm-driver';

const result = await testLLMConnection({
    provider: 'openai',
    apiKey: 'sk-xxx',
    model: 'gpt-4o-mini'
});

if (result.success) {
    console.log(`Connected! Latency: ${result.latency}ms`);
} else {
    console.error(`Failed: ${result.message}`);
}
```

### 6.4 自定义 Provider

```typescript
import { 
    LLMDriver, 
    registerProvider, 
    BaseProvider,
    LLMProviderConfig,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk
} from '@itookit/llm-driver';

// 实现自定义 Provider
class MyCustomProvider extends BaseProvider {
    readonly name = 'my-custom';
    
    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        // 自定义实现
    }
    
    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        // 自定义实现
    }
}

// 注册
registerProvider('my-custom', MyCustomProvider);

// 使用
const driver = new LLMDriver({
    provider: 'my-custom',
    apiKey: 'xxx',
    apiBaseUrl: 'https://my-api.com'
});
```

---

## 7. 总结

### 7.1 重构后的 llm-driver 特点

| 特点 | 说明 |
|------|------|
| **纯粹性** | 只负责 LLM API 通信，无执行逻辑 |
| **无状态** | 不维护任何会话状态 |
| **可独立使用** | 不依赖 VFS、不依赖其他业务模块 |
| **Provider 可扩展** | 支持注册自定义 Provider |
| **统一接口** | 所有 Provider 使用相同的输入输出格式 |
| **完善的错误处理** | 统一的 LLMError 类型 |

### 7.2 与其他层的交互

```
┌─────────────────────────────────────────────────────────┐
│                     llm-engine                          │
│  (会话管理、持久化、UI 适配)                              │
└─────────────────────┬───────────────────────────────────┘
                      │ 使用
                      ▼
┌─────────────────────────────────────────────────────────┐
│                     llm-kernel                          │
│  (执行器、编排器、事件系统)                               │
│                                                         │
│  AgentExecutor 内部使用 LLMDriver 进行 API 调用          │
└─────────────────────┬───────────────────────────────────┘
                      │ 依赖
                      ▼
┌─────────────────────────────────────────────────────────┐
│                     llm-driver                          │
│  (LLM API 通信、Provider 抽象、流处理)                   │
│                                                         │
│  纯粹的通信层，无业务逻辑                                 │
└─────────────────────────────────────────────────────────┘
```