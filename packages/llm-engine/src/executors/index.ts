// Executors — ILoop implementations for all execution modes.
//
// Each executor is registered via ExecutorRegistry.
// The kernel dispatches by mode string; UI sees only the unified AgentEvent stream.

export { chatExecutor } from './chat-executor';
export { LoopExecutor } from './loop-executor';
export { createLoopExecutor } from './loop-presets';
export type { LoopPresetConfig } from './loop-presets';
export {
    createBudgetMiddleware,
    createErrorRecoveryMiddleware,
    createCompressionMiddleware,
    createHITLMiddleware,
    createSkillsMiddleware,
    createBackPressureMiddleware,
} from './loop-middleware';
