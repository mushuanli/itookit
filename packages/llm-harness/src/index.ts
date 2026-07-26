// @file: llm-harness/src/index.ts
// @itookit/llm-harness 主出口。

// ── Built-in tools (from @itookit/tools) ──
export { BUILTIN_TOOLS } from '@itookit/tools';

// ── Harness-specific dynamic tools ──
export {
    createLoadSkillHandler,
    loadSkillDefinition,
    loadSkillMeta,
} from './tools/load-skill';
export { humanInputMeta, humanInputDefinition } from './tools/human-input';

// ── Device drivers ──
export { ToolDeviceDriver } from '@itookit/tools';
export { SkillDeviceDriver } from './drivers/skill-device-driver';

// ── Adapters ──
export { LLMServiceAdapter } from './adapters/llm-service-adapter';

// ── Factory ──
export { createHarness } from './factory';
export type { HarnessOptions, HarnessInstance } from './factory';

// ── Process kernel ──
export { HarnessKernel } from './kernel/harness-kernel';
export type { HarnessKernelOptions } from './kernel/harness-kernel';
export { ProcessTable } from './kernel/process-table';
export { ProcessProgramRegistry } from './kernel/program-registry';
export { ProcessDispatcher } from './kernel/dispatcher';
export type { ProcessDispatcherOptions } from './kernel/dispatcher';
export { DirectScheduler } from './scheduling/direct/direct-scheduler';
export { DagScheduler } from './scheduling/dag/dag-scheduler';
export { FifoSchedulingPolicy } from './scheduling/fifo-policy';
export {
    InMemoryProcessCheckpointStore,
    InMemoryRunEventStore,
} from './persistence/memory-stores';
export { DagPluginRegistry } from './plugins/dag-plugin-registry';
export {
    builtinDagPrograms,
    registerBuiltinDagPlugins,
} from './plugins/builtin';

// ── Shell runner (Node.js only) ──
export { NodeShellRunner } from './shell/node-shell-runner';

// ── TTY device (Node.js only) — re-exported from @itookit/device-tty ──
export { NodeTTYDriver, TTYSessionManager } from '@itookit/device-tty';
export type { NodeTTYSession } from '@itookit/device-tty';
