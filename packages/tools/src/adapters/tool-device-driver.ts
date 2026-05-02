// @file: tools/src/adapters/tool-device-driver.ts
// ToolDeviceDriver — bridges Tool[] → IToolService + IDeviceDriver.
// Migrated from llm-harness/src/drivers/tool-device-driver.ts

import { z } from 'zod/v4';
import type {
  IToolService,
  ToolMeta,
  ToolDefinition,
  ToolInvokeRequest,
  ToolInvokeResult,
  ToolBatchResult,
  ToolVFSContext,
  DeviceContext,
  IDeviceDriver,
  ToolHandler,
} from '@itookit/common';
import type { Tool } from '../core/Tool';
import type { INativeShell } from '../core/types';

// ── Registry entry ──

interface RegisteredTool {
  meta: ToolMeta;
  definition: ToolDefinition;
  tool: Tool;
}

// ── Meta/Definition builders ──

function toolMetaFromTool(tool: Tool): ToolMeta {
  return {
    id: tool.name,
    name: tool.userFacingName(undefined),
    description: '',
    sideEffect: tool.isReadOnly() ? 'none' : 'local',
    timeoutMs: 30_000,
    type: 'builtin',
    enabled: tool.isEnabled(),
    tags: tool.searchHint ? [tool.searchHint] : [],
  };
}

function toolDefinitionFromTool(tool: Tool): ToolDefinition {
  // Convert the tool's Zod input schema to a JSON Schema object for the LLM.
  let parameters: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
  try {
    const schema = tool.inputSchema;
    if (schema) {
      parameters = z.toJSONSchema(schema) as Record<string, unknown>;
    }
  } catch {
    // Fall back to empty schema if conversion fails (e.g. no inputSchema defined).
  }

  return {
    name: tool.name,
    description: '', // filled in by init()
    parameters,
  };
}

// ── Driver ──

export class ToolDeviceDriver implements IDeviceDriver, IToolService {
  readonly handlerId = 'tools';
  readonly description = 'Built-in tool execution device';
  readonly writable = false;
  readonly streamable = false;
  readonly sessionable = false;

  private registry = new Map<string, RegisteredTool>();
  private vfsContext: ToolVFSContext | undefined = undefined;
  private shellContext: INativeShell | undefined = undefined;

  /**
   * Session-scoped app state shared across all tool invocations.
   * Provides isolation for stateful tools (Task, PlanMode) between sessions.
   * Call clearSessionState() when starting a new agent session if isolation is needed.
   */
  private sessionAppState: Record<string, unknown> = {};

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      const meta = toolMetaFromTool(tool);
      const definition = toolDefinitionFromTool(tool);
      this.registry.set(tool.name, { meta, definition, tool });
    }
  }

  /** Inject a VFS context for browser environments. */
  setVFSContext(ctx: ToolVFSContext): void {
    this.vfsContext = ctx;
  }

  /**
   * Inject a native shell for Node.js / Tauri environments.
   * When set, search tools (GrepTool, GlobTool) use rg/fd instead of manual FS walking,
   * and BashTool can run in Tauri where node:child_process is unavailable.
   *
   * @example (Node.js)
   *   const shell = await createNodeNativeShell();
   *   toolDriver.setNativeShell(shell);
   *
   * @example (Tauri)
   *   const shell = await TauriNativeShell.create();
   *   toolDriver.setNativeShell(shell);
   */
  setNativeShell(shell: INativeShell): void {
    this.shellContext = shell;
  }

  /** Clear session-scoped app state between agent sessions for full isolation. */
  clearSessionState(): void {
    this.sessionAppState = {};
  }

  /** Register an additional tool at runtime (e.g. from Skill loading). */
  registerToolInstance(tool: Tool): void {
    const meta = toolMetaFromTool(tool);
    const definition = toolDefinitionFromTool(tool);
    this.registry.set(tool.name, { meta, definition, tool });
  }

  async init(): Promise<void> {
    for (const entry of this.registry.values()) {
      const desc = await entry.tool.description();
      entry.meta.description = desc;
      entry.definition.description = desc;
    }
  }

  async dispose(): Promise<void> {
    this.registry.clear();
  }

  // ── IDeviceDriver ──

  async read(_ctx: DeviceContext): Promise<string> {
    return this.listTools().map((m) => `${m.id}: ${m.description}`).join('\n');
  }

  async write(_ctx: DeviceContext): Promise<void> {}

  async ioctl(_ctx: DeviceContext, command: string, arg?: unknown): Promise<unknown> {
    if (command === 'invoke' && arg) return this.invoke(arg as ToolInvokeRequest);
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

    const cwd = request.cwd ?? (typeof process !== 'undefined' ? process.cwd() : '/');
    const timeoutMs = request.timeoutMs ?? entry.meta.timeoutMs;
    const t0 = Date.now();

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    if (request.signal) {
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    try {
      const appState = this.sessionAppState;
      const result = await entry.tool.call(request.args, {
        cwd,
        signal: abortController.signal,
        timeoutMs,
        vfs: this.vfsContext,
        shell: this.shellContext,
        abortController,
        appState,
        setAppState: (key, value) => { appState[key] = value; },
      });

      const blockParam = entry.tool.mapToolResultToToolResultBlockParam(result.data, request.toolId);
      const output = typeof blockParam.content === 'string'
        ? blockParam.content
        : JSON.stringify(blockParam.content);

      return {
        toolId: request.toolId,
        success: true,
        output,
        durationMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolId: request.toolId,
        success: false,
        output: `Error: ${msg}`,
        durationMs: Date.now() - t0,
        error: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async invokeBatch(requests: ToolInvokeRequest[]): Promise<ToolBatchResult> {
    const t0 = Date.now();
    const indexed = requests.map((req, idx) => ({ req, idx }));
    const reads = indexed.filter(({ req }) => {
      const entry = this.registry.get(req.toolId);
      return entry?.tool.isConcurrencySafe() ?? false;
    });
    const writes = indexed.filter(({ req }) => {
      const entry = this.registry.get(req.toolId);
      return !(entry?.tool.isConcurrencySafe() ?? false);
    });

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
    // Wrap a ToolHandler as a Tool adapter for backward compatibility.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = {
      name: meta.id,
      maxResultSizeChars: 50_000,
      description() { return Promise.resolve(meta.description); },
      prompt() { return Promise.resolve(meta.description); },
      userFacingName() { return meta.name; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: {} as any,
      isConcurrencySafe() { return meta.sideEffect === 'none'; },
      isReadOnly() { return meta.sideEffect === 'none'; },
      isEnabled() { return meta.enabled; },
      async call(args: Record<string, unknown>, context: Record<string, unknown>) {
        const result = await handler(args, context as unknown as Parameters<typeof handler>[1]);
        return { data: result };
      },
      mapToolResultToToolResultBlockParam(data: unknown, toolUseId: string) {
        return {
          tool_use_id: toolUseId,
          type: 'tool_result' as const,
          content: String(data),
        };
      },
    } as unknown as Tool;
    this.registry.set(meta.id, { meta, definition, tool: adapter });
  }

  unregisterTool(id: string): void {
    this.registry.delete(id);
  }

  getService(): IToolService {
    return this;
  }
}
