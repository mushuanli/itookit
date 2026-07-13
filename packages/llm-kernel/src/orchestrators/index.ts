// @file: llm-kernel/orchestrators/index.ts

import type { OrchestratorType, IOrchestrator, IOrchestratorFactory } from '../core/orchestrator-interfaces';
import { SerialOrchestrator } from './serial-orchestrator';
import { ParallelOrchestrator } from './parallel-orchestrator';
import { RouterOrchestrator } from './router-orchestrator';
import { LoopOrchestrator } from './loop-orchestrator';
import { DagOrchestrator } from './dag-orchestrator';

export { SerialOrchestrator } from './serial-orchestrator';
export { ParallelOrchestrator } from './parallel-orchestrator';
export { RouterOrchestrator } from './router-orchestrator';
export { LoopOrchestrator } from './loop-orchestrator';
export { DagOrchestrator, CycleError } from './dag-orchestrator';

/**
 * 编排器注册表 — 按类型管理所有编排器实例
 */
export class OrchestratorRegistry implements IOrchestratorFactory {
    private instances = new Map<OrchestratorType, IOrchestrator>();

    constructor() {
        this.registerBuiltins();
    }

    private registerBuiltins(): void {
        this.instances.set('serial', new SerialOrchestrator());
        this.instances.set('parallel', new ParallelOrchestrator());
        this.instances.set('router', new RouterOrchestrator());
        this.instances.set('loop', new LoopOrchestrator());
        this.instances.set('dag', new DagOrchestrator());
    }

    create(type: OrchestratorType): IOrchestrator {
        const orchestrator = this.instances.get(type);
        if (!orchestrator) {
            throw new Error(`Unknown orchestrator type: ${type}`);
        }
        return orchestrator;
    }

    supports(type: OrchestratorType): boolean {
        return this.instances.has(type);
    }

    /** Register a custom orchestrator (for plugin use) */
    register(type: OrchestratorType, orchestrator: IOrchestrator): void {
        this.instances.set(type, orchestrator);
    }

    getRegisteredTypes(): OrchestratorType[] {
        return Array.from(this.instances.keys());
    }
}

// Module-level singleton
let globalRegistry: OrchestratorRegistry | null = null;

export function getOrchestratorRegistry(): OrchestratorRegistry {
    if (!globalRegistry) {
        globalRegistry = new OrchestratorRegistry();
    }
    return globalRegistry;
}

export function resetOrchestratorRegistry(): void {
    globalRegistry = null;
}
