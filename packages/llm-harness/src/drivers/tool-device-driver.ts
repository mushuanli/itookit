// @file: llm-harness/src/drivers/tool-device-driver.ts
// 工具设备驱动：注册内置工具，实现 IDeviceDriver + IToolService。

import type {
    IDeviceDriver,
    IToolService,
    ToolMeta,
    ToolDefinition,
    ToolInvokeRequest,
    ToolInvokeResult,
    ToolBatchResult,
    DeviceContext,
} from '@itookit/common';
import type { ToolHandler } from '@itookit/common';
import { BUILTIN_TOOLS } from '../tools/index';

interface RegisteredTool {
    meta: ToolMeta;
    definition: ToolDefinition;
    handler: ToolHandler;
}

export class ToolDeviceDriver implements IDeviceDriver, IToolService {
    readonly handlerId = 'tools';
    readonly description = 'Built-in tool execution device';
    readonly writable = false;
    readonly streamable = false;
    readonly sessionable = false;

    private registry = new Map<string, RegisteredTool>();

    constructor() {
        // Register all built-in tools at construction time
        for (const entry of BUILTIN_TOOLS) {
            this.registerTool(entry.meta, entry.definition, entry.handler);
        }
    }

    async init(): Promise<void> {}
    async dispose(): Promise<void> {}

    // ── IDeviceDriver (minimal VFS device surface) ──

    async read(_ctx: DeviceContext): Promise<string> {
        return this.listTools().map((m) => `${m.id}: ${m.description}`).join('\n');
    }

    async write(_ctx: DeviceContext): Promise<void> {}

    async ioctl(_ctx: DeviceContext, command: string, arg?: unknown): Promise<unknown> {
        if (command === 'invoke' && arg) {
            return this.invoke(arg as ToolInvokeRequest);
        }
        if (command === 'list') return this.listTools();
        throw new Error(`Unknown ioctl command: ${command}`);
    }

    // ── IToolService ──

    listTools(): ToolMeta[] {
        return [...this.registry.values()].map((e) => e.meta);
    }

    getToolMeta(id: string): ToolMeta | undefined {
        return this.registry.get(id)?.meta;
    }

    getToolDefinitions(): ToolDefinition[] {
        return [...this.registry.values()]
            .filter((e) => e.meta.enabled)
            .map((e) => e.definition);
    }

    async invoke(request: ToolInvokeRequest): Promise<ToolInvokeResult> {
        const entry = this.registry.get(request.toolId);
        if (!entry) {
            return {
                toolId: request.toolId,
                success: false,
                output: `Error: tool not found: ${request.toolId}`,
                durationMs: 0,
                error: 'tool_not_found',
            };
        }

        const cwd = request.cwd ?? process.cwd();
        const timeoutMs = request.timeoutMs ?? entry.meta.timeoutMs;
        const t0 = Date.now();

        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);

        if (request.signal) {
            request.signal.addEventListener('abort', () => abortController.abort());
        }

        try {
            const output = await entry.handler(request.args, { cwd, signal: abortController.signal, timeoutMs });
            return { toolId: request.toolId, success: true, output, durationMs: Date.now() - t0 };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { toolId: request.toolId, success: false, output: `Error: ${msg}`, durationMs: Date.now() - t0, error: msg };
        } finally {
            clearTimeout(timer);
        }
    }

    async invokeBatch(requests: ToolInvokeRequest[]): Promise<ToolBatchResult> {
        const t0 = Date.now();

        // Tag each request with its original index so ordering is restored correctly
        // even when the same toolId appears multiple times.
        const indexed = requests.map((req, idx) => ({ req, idx }));
        const reads  = indexed.filter(({ req }) => this.registry.get(req.toolId)?.meta.sideEffect === 'none');
        const writes = indexed.filter(({ req }) => this.registry.get(req.toolId)?.meta.sideEffect !== 'none');

        const slotted: ToolInvokeResult[] = new Array(requests.length);

        // Reads in parallel
        const readResults = await Promise.all(reads.map(({ req }) => this.invoke(req)));
        for (let i = 0; i < reads.length; i++) {
            slotted[reads[i].idx] = readResults[i];
        }

        // Writes serially
        for (const { req, idx } of writes) {
            slotted[idx] = await this.invoke(req);
        }

        return { results: slotted, totalDurationMs: Date.now() - t0 };
    }

    registerTool(meta: ToolMeta, definition: ToolDefinition, handler: ToolHandler): void {
        this.registry.set(meta.id, { meta, definition, handler });
    }

    unregisterTool(id: string): void {
        this.registry.delete(id);
    }

    getService(): IToolService {
        return this;
    }
}
