# @itookit/device-tty

TTY 设备驱动 — Node.js child_process 交互式 shell 会话。实现 `ITTYDriver` / `ITTYSession` 接口。

Node-only，浏览器环境自动降级（spawn 抛出 clear error）。

## Architecture

```
src/
├── index.ts              ← 公共 API
├── node-tty-driver.ts    ← NodeTTYDriver + NodeTTYSession (child_process.spawn)
├── node-pty-driver.ts    ← NodePtyDriver + NodePtySession (node-pty)
└── session-manager.ts    ← TTYSessionManager + collectOutput
```

## Usage

```typescript
import { NodeTTYDriver } from '@itookit/device-tty';
// 注入 coreutils 运行时（ITTYDriver 槽位）
const runtime = await createCoreutilsRuntime({ llmDriver, ttyDriver: new NodeTTYDriver(), ... });
// 或通过 app-shell bootstrap 装配，见 packages/app-shell/src/bootstrap.ts
```
