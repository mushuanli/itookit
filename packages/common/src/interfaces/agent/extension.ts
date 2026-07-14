// Extension system for the LLM subsystem (llm-engine layer).
//
// Distinct from the VFS-layer IPlugin in common/interfaces/fs/plugin/.
// This is the LLM-specific plugin system following VS Code's contribution points model.
//
// 6 extension points (Rule of Three — each has ≥3 real consumers):
//   executors   — ILoop implementations (chat / loop / mission / graph)
//   middleware  — ILoopMiddleware factories (budget / compression / recovery / hitl / skills / back-pressure)
//   commands    — ICommandBus handlers (vcs / session / tasks)
//   tools       — IToolService registrations (existing registry)
//   views       — projection functions (history / tasks panel / cost dashboard)
//   predicates  — Predicate factories (truncation / shell / LLM-judge)

import type { ICommandBus } from './command-bus';
import type { ILog } from './loop';

export interface ExtensionContext {
    /** The session log — read-only for most plugins; vcs plugin uses refs(). */
    log: ILog;
    /** The command bus — plugins contribute commands here. */
    commands: ICommandBus;
}

export interface ILLMPlugin {
    readonly name: string;
    activate(ctx: ExtensionContext): void;
    deactivate?(): void;
}

export interface IExtensionRegistry {
    /** Register a plugin. Must be called before activate(). */
    register(plugin: ILLMPlugin): void;
    /** Activate all registered plugins with the given context. */
    activate(ctx: ExtensionContext): void;
    /** Deactivate all plugins (e.g. on session teardown). */
    deactivate(): void;
}
