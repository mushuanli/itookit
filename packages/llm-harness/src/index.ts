// @file: llm-harness/src/index.ts
// @itookit/llm-harness 主出口。

// ── Executor components ──
export { AgentLoopExecutor } from './executor/agent-loop-executor';
export { BudgetController } from './executor/budget-controller';
export { ErrorRecoveryService } from './executor/error-recovery';
export { BackPressureValidator } from './executor/back-pressure';
export { ContextManager } from './executor/context-manager';
export { SubAgentRouter } from './executor/sub-agent-router';

// ── Built-in tools (from @itookit/tools) ──
export { BUILTIN_TOOLS } from '@itookit/tools';

// ── Harness-specific dynamic tools ──
export { createLoadSkillHandler, createDelegateTaskHandler } from './tools/index';
export type { BuiltinToolEntry } from './tools/index';
export { createDelegateAgentHandler, delegateAgentMeta, delegateAgentDefinition } from './tools/delegate-agent';
export { createWriteResultHandler, writeResultMeta, writeResultDefinition } from './tools/write-result';
export { createHumanInputHandler, humanInputMeta, humanInputDefinition } from './tools/human-input';

// ── Mission services ──
export { HITLQueue } from './services/hitl-queue';

// ── Device drivers ──
export { ToolDeviceDriver } from '@itookit/tools';
export { SkillDeviceDriver } from './drivers/skill-device-driver';
export { AgentDeviceDriver } from './drivers/agent-device-driver';

// ── Adapters ──
export { LLMServiceAdapter } from './adapters/llm-service-adapter';

// ── Factory ──
export { createHarness } from './factory';
export type { HarnessOptions, HarnessInstance } from './factory';

// ── Shell runner (Node.js only) ──
export { NodeShellRunner } from './shell/node-shell-runner';

// ── TTY device (Node.js only) — re-exported from @itookit/device-tty ──
export { NodeTTYDriver, TTYSessionManager } from '@itookit/device-tty';
export type { NodeTTYSession } from '@itookit/device-tty';
