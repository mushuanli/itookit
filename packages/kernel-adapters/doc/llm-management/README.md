# @itookit/kernel-adapters/llm

MindOS 的 LLM 宿主集成层。独立模型通信请使用 `@itookit/driver-llm`。

本包承接旧 device-llm 的 VFS 设备接口、Provider/Connection 配置、费用记录、默认 Agent、系统提示词、Skill、MCP 和 `.llm` 配置导入导出。

```ts
import { LLMDeviceDriver } from '@itookit/kernel-adapters/llm';

const driver = new LLMDeviceDriver(vfs, { llmLogger });
await driver.init();
// 通过原有 VFS 设备和管理接口使用，退出时调用 driver.dispose()。
```

配置路径、ioctl、设备会话和持久数据格式保持原有语义；现有配置无需迁移。MCP stdio 由 Node 或宿主桥提供，浏览器条件入口不加载 Node transport。

详见 [设备协议](./driver-details.md)。
