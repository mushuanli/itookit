// ExecutorRegistry — single dispatch point for ILoop implementations.
//
// All execution modes (chat / loop / mission / graph) register their ILoop
// implementation here. SessionManager.sendMessage() dispatches by mode
// instead of branching on useHarness / useKernel flags.

import type { ILoop } from '@itookit/common';

export class ExecutorRegistry {
    private readonly executors = new Map<string, ILoop>();
    private _defaultMode: string = 'chat';

    register(executor: ILoop): void {
        if (this.executors.has(executor.mode)) {
            throw new Error(`ExecutorRegistry: duplicate mode "${executor.mode}"`);
        }
        this.executors.set(executor.mode, executor);
    }

    unregister(mode: string): void {
        this.executors.delete(mode);
    }

    get(mode: string): ILoop {
        const executor = this.executors.get(mode);
        if (!executor) {
            throw new Error(`ExecutorRegistry: no executor registered for mode "${mode}"`);
        }
        return executor;
    }

    get defaultMode(): string {
        return this._defaultMode;
    }

    setDefaultMode(mode: string): void {
        if (!this.executors.has(mode)) {
            throw new Error(`ExecutorRegistry: cannot set default to unregistered mode "${mode}"`);
        }
        this._defaultMode = mode;
    }

    listRegistrations(): Array<{ mode: string }> {
        return Array.from(this.executors.entries()).map(([mode]) => ({ mode }));
    }
}

let registry: ExecutorRegistry | null = null;

export function getExecutorRegistry(): ExecutorRegistry {
    if (!registry) {
        registry = new ExecutorRegistry();
    }
    return registry;
}

export function resetExecutorRegistry(): void {
    registry = null;
}
