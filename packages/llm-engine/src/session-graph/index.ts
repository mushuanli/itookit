// @file: llm-engine/session-graph/index.ts
// File-based session dependency graph — public API.
//
// Quick-start:
//   const orchestrator = new GraphOrchestrator(vfsManager);
//   await orchestrator.executeSession('minds', '/project/impl.md', {
//     runtime: harness.runtime,
//     llm:     harness.llmService,   // only needed for advance mode
//     onProgress: (e) => console.log(e),
//   });
//
// Dependency declaration — store in each session file's assetdir via
// GraphOrchestrator.setDependencies() or the slash command /session-deps:
//   { dependencies: ["./requirements.md", "./data/"] }

export type {
    SessionMeta,
    SessionType,
    SessionStatus,
    SessionExecutionResult,
    GraphExecutionOptions,
    GraphEvent,
    CompletionVerdict,
} from './types';

export { DEFAULT_SESSION_META } from './types';
export { GraphOrchestrator } from './graph-orchestrator';
export { DependencyGraph, CycleError } from './dependency-graph';
export { SessionMetaStore } from './session-meta-store';
export { CompletionAnalyzer } from './completion-analyzer';
