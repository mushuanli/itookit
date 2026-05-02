// @file: llm-harness/src/drivers/agent-device-driver.ts
// Agent device driver — assembles AgentLoopExecutor, mountable at /dev/agent.
//
// Responsibilities:
//   1. Manages sub-service dependencies (LLM, Tool, Skill)
//   2. Creates and owns the SubAgentRouter (rebuilt when modelRoles change)
//   3. Registers dynamic tools (load_skill, delegate_task) after services are wired
//   4. Reads per-token pricing from the connection's model info and passes it to the executor
//   5. Implements IAgentRuntimeConfig for runtime configuration management
//   6. Bridges to VFS device system via IDeviceDriver (read/write/ioctl)

import type {
    IDeviceDriver,
    IAgentRuntime,
    IAgentRuntimeConfig,
    ILLMService,
    IToolService,
    ISkillService,
    ITTYDriver,
    AgentModelRoles,
    AgentBudgetLimits,
    AgentLoopConfig,
    DeviceContext,
    IAgentLookup,
    IResultPersistenceService,
    AgentEventType,
    AgentEventPayloads,
} from '@itookit/common';
import { AgentLoopExecutor } from '../executor/agent-loop-executor';
import { SubAgentRouter } from '../executor/sub-agent-router';
import { loadSkillMeta, loadSkillDefinition, createLoadSkillHandler } from '../tools/load-skill';
import { delegateTaskMeta, delegateTaskDefinition, createDelegateTaskHandler } from '../tools/delegate-task';
import { delegateAgentMeta, delegateAgentDefinition, createDelegateAgentHandler } from '../tools/delegate-agent';
import { writeResultMeta, writeResultDefinition, createWriteResultHandler } from '../tools/write-result';
import { humanInputMeta, humanInputDefinition, createHumanInputHandler } from '../tools/human-input';
import { TTYSessionManager } from '@itookit/device-tty';
import { shellSessionMeta, shellSessionDefinition, createShellSessionHandler } from '../tools/shell-session';
import { ttyWriteMeta, ttyWriteDefinition, createTtyWriteHandler } from '../tools/tty-write';
import { ttyCloseMeta, ttyCloseDefinition, createTtyCloseHandler } from '../tools/tty-close';
import type { HITLQueue } from '../services/hitl-queue';

interface CostModel {
    perInputToken: number;
    perOutputToken: number;
}

const DEFAULT_BUDGET: AgentBudgetLimits = {
    maxTurns: 100,
    maxInputTokens: 5_000_000,
    maxOutputTokens: 1_000_000,
    maxCostUsd: 10,
    maxDurationMs: 3_600_000,
    maxToolCalls: 500,
};

const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
    maxApiRetries: 5,
    maxTruncationRetries: 3,
    baseRetryDelayMs: 1000,
    compressionThreshold: 0.75,
    systemPromptBudgetTokens: 4000,
    enableBackPressure: true,
    backPressureRules: [],
    enablePlanConfirm: false, // opt-in; UI sets it true when the toggle is on
};

export class AgentDeviceDriver implements IDeviceDriver, IAgentRuntimeConfig {
    readonly handlerId = 'agent';
    readonly description = 'Agent loop execution device';
    readonly writable = true;
    readonly streamable = false;
    readonly sessionable = false;

    private runtime: AgentLoopExecutor | null = null;
    private router: SubAgentRouter | null = null;

    private llm: ILLMService | null = null;
    private toolService: IToolService | null = null;
    private skillService: ISkillService | null = null;
    private ttyDriver: ITTYDriver | null = null;
    private ttyManager: TTYSessionManager = new TTYSessionManager();

    // Mission optional services
    private agentLookup: IAgentLookup | null = null;
    private resultPersistence: IResultPersistenceService | null = null;
    private hitlQueue: HITLQueue | null = null;

    private modelRoles: AgentModelRoles = { primary: '' };
    private budgetLimits: AgentBudgetLimits = { ...DEFAULT_BUDGET };
    private loopConfig: AgentLoopConfig = { ...DEFAULT_LOOP_CONFIG };
    private costModel: CostModel | undefined = undefined;

    private changeListeners: Array<() => void> = [];
    /** Guards TTY tool registration — TTY sessions must survive router rebuilds. */
    private ttyToolsRegistered = false;

    // ── Dependency injection ──

    /**
     * Inject an optional ITTYDriver to enable interactive shell sessions.
     * Must be called before setServices().
     * Without a driver, shell_session / tty_write / tty_close are not registered.
     */
    setTTYDriver(driver: ITTYDriver): void {
        this.ttyDriver = driver;
    }

    setServices(services: {
        llm: ILLMService;
        tool: IToolService;
        skill: ISkillService;
        /** Optional: enables delegate_agent tool */
        agentLookup?: IAgentLookup;
        /** Optional: enables write_result tool */
        resultPersistence?: IResultPersistenceService;
        /** Optional: enables human_input tool */
        hitlQueue?: HITLQueue;
    }): void {
        this.llm = services.llm;
        this.toolService = services.tool;
        this.skillService = services.skill;
        this.agentLookup = services.agentLookup ?? null;
        this.resultPersistence = services.resultPersistence ?? null;
        this.hitlQueue = services.hitlQueue ?? null;
        // Give SkillDeviceDriver access to ToolService so HTTP skills can register their tools on load.
        if ('setToolService' in services.skill && typeof (services.skill as Record<string, unknown>)['setToolService'] === 'function') {
            (services.skill as { setToolService: (t: IToolService) => void }).setToolService(services.tool);
        }
        this.rebuildRouter();
        this.registerDynamicTools();
        this.runtime = null; // force rebuild on next getRuntime()
    }

    async init(): Promise<void> {
        // Auto-detect primary connection if not configured.
        if (!this.modelRoles.primary && this.llm) {
            const conn = await this.llm.getDefaultConnection();
            if (conn) {
                this.modelRoles.primary = conn.id;
                // Derive per-token pricing from the provider's model catalog.
                const pid = conn.providerId ?? conn.provider;
                if (pid) {
                    const provider = this.llm.getProvider
                        ? await this.llm.getProvider(pid)
                        : undefined;
                    const modelId = conn.model;
                    const modelInfo = provider?.models.find(m => m.id === modelId);
                    if (modelInfo?.inputPricePerMillion !== undefined) {
                        this.costModel = {
                            perInputToken: modelInfo.inputPricePerMillion / 1_000_000,
                            perOutputToken: (modelInfo.outputPricePerMillion ?? modelInfo.inputPricePerMillion * 5) / 1_000_000,
                        };
                    }
                }
            }
        }
    }

    async dispose(): Promise<void> {
        this.runtime?.abort();
        this.ttyManager.abortAll();
        this.hitlQueue?.abortAll();
        this.runtime = null;
        this.router  = null;
    }

    getRuntime(): IAgentRuntime {
        return this.ensureRuntime();
    }

    // ── IDeviceDriver ──

    async read(ctx: DeviceContext): Promise<string> {
        if (ctx.name === 'status') {
            const session = this.runtime?.getCurrentSession();
            return JSON.stringify(session ?? { status: 'idle' });
        }
        return '{}';
    }

    async write(ctx: DeviceContext, content: string | ArrayBuffer | Uint8Array): Promise<void> {
        if (ctx.name === 'run' && typeof content === 'string') {
            const task = JSON.parse(content);
            this.ensureRuntime().run(task).catch(() => {});
        }
    }

    async ioctl(_ctx: DeviceContext, command: string, arg?: unknown): Promise<unknown> {
        const runtime = this.ensureRuntime();
        switch (command) {
            case 'run':    return runtime.run(arg as Parameters<IAgentRuntime['run']>[0]);
            case 'abort':  runtime.abort(); return;
            case 'get_session':    return runtime.getCurrentSession();
            case 'list_sessions':  return runtime.listRecentSessions(arg as number | undefined);
            case 'resume':         return runtime.resumeSession(arg as string);
            case 'delete_session': runtime.deleteSession(arg as string); return;
            case 'get_config':     return {
                modelRoles: this.modelRoles,
                budgetLimits: this.budgetLimits,
                loopConfig: this.loopConfig,
            };
            default: throw new Error(`Unknown ioctl command: ${command}`);
        }
    }

    // ── IAgentRuntimeConfig ──

    getModelRoles(): AgentModelRoles { return { ...this.modelRoles }; }

    async setModelRoles(roles: Partial<AgentModelRoles>): Promise<void> {
        this.modelRoles = { ...this.modelRoles, ...roles };
        // Rebuild router so it uses the new model assignments.
        this.rebuildRouter();
        this.registerDynamicTools();
        this.runtime = null; // executor picks up new roles on next run
        this.notifyChange();
    }

    getBudgetLimits(): AgentBudgetLimits { return { ...this.budgetLimits }; }

    async setBudgetLimits(limits: Partial<AgentBudgetLimits>): Promise<void> {
        this.budgetLimits = { ...this.budgetLimits, ...limits };
        this.notifyChange();
    }

    getLoopConfig(): AgentLoopConfig { return { ...this.loopConfig }; }

    async setLoopConfig(config: Partial<AgentLoopConfig>): Promise<void> {
        this.loopConfig = { ...this.loopConfig, ...config };
        this.runtime = null; // executor picks up new config on next run
        this.notifyChange();
    }

    onChange(listener: () => void): () => void {
        this.changeListeners.push(listener);
        return () => {
            const idx = this.changeListeners.indexOf(listener);
            if (idx >= 0) this.changeListeners.splice(idx, 1);
        };
    }

    // ── Private ──

    private rebuildRouter(): void {
        if (!this.llm || !this.toolService) return;
        this.router = new SubAgentRouter(this.llm, this.toolService, this.modelRoles);
    }

    /** (Re-)registers dynamic tools that need live service references. Idempotent. */
    private registerDynamicTools(): void {
        if (!this.toolService || !this.skillService || !this.router) return;

        this.toolService.registerTool(loadSkillMeta, loadSkillDefinition, createLoadSkillHandler(this.skillService));
        this.toolService.registerTool(delegateTaskMeta, delegateTaskDefinition, createDelegateTaskHandler(this.router));

        // Mission tools — registered only when optional services are provided
        if (this.agentLookup) {
            this.toolService.registerTool(
                delegateAgentMeta,
                delegateAgentDefinition,
                createDelegateAgentHandler(this.router, this.agentLookup),
            );
        }
        if (this.resultPersistence) {
            this.toolService.registerTool(
                writeResultMeta,
                writeResultDefinition,
                createWriteResultHandler(this.resultPersistence),
            );
        }
        if (this.hitlQueue) {
            // Wire the onRequest callback so HITL requests emit agent events
            // before the human_input tool's push() promise blocks.
            this.hitlQueue.onRequest = (request) => {
                this.runtime?.emit('agent:human:input', {
                    requestId: request.id,
                    missionId: request.missionId,
                    todoId: request.todoId,
                    context: request.context,
                    question: request.question,
                    options: request.options,
                    files: request.files,
                });
            };
            this.toolService.registerTool(
                humanInputMeta,
                humanInputDefinition,
                createHumanInputHandler(this.hitlQueue),
            );
        }

        // TTY tools — registered once per driver lifetime.
        // The emitter accesses this.runtime lazily, so TTY events work even after router rebuilds.
        // Re-registration is skipped to avoid creating duplicate event-handler closures
        // and to preserve in-flight TTY sessions across setModelRoles() calls.
        if (this.ttyDriver && !this.ttyToolsRegistered) {
            this.ttyToolsRegistered = true;
            const emitter = this.makeEventEmitter();
            this.toolService.registerTool(
                shellSessionMeta,
                shellSessionDefinition,
                createShellSessionHandler(this.ttyDriver, this.ttyManager, emitter),
            );
            this.toolService.registerTool(
                ttyWriteMeta,
                ttyWriteDefinition,
                createTtyWriteHandler(this.ttyManager, emitter),
            );
            this.toolService.registerTool(
                ttyCloseMeta,
                ttyCloseDefinition,
                createTtyCloseHandler(this.ttyManager, emitter),
            );
        }
    }

    /**
     * Returns an event emitter shim that routes agent:tty:* events through
     * the AgentLoopExecutor's event system once a runtime exists.
     * Accesses this.runtime lazily so tools registered before the first run() still work.
     */
    private makeEventEmitter(): (type: string, payload: Record<string, unknown>) => void {
        return (type, payload) => {
            this.runtime?.emit(type as AgentEventType, payload as AgentEventPayloads[AgentEventType]);
        };
    }

    private ensureRuntime(): AgentLoopExecutor {
        if (!this.runtime) {
            if (!this.llm || !this.toolService || !this.skillService || !this.router) {
                throw new Error('AgentDeviceDriver: services not injected. Call setServices() first.');
            }
            this.runtime = new AgentLoopExecutor(
                this.llm,
                this.toolService,
                this.skillService,
                this.modelRoles,
                this.loopConfig,
                this.budgetLimits,
                this.router,
                undefined,      // maxContextTokens — use executor default (200 000)
                this.costModel, // pricing from connection metadata
                this.hitlQueue ?? undefined, // HITL queue for human_input tool
            );
            // Give the executor access to the TTY session manager so ttyWrite() works.
            this.runtime.setTTYManager(this.ttyManager);
        }
        return this.runtime;
    }

    private notifyChange(): void {
        for (const l of this.changeListeners) l();
    }
}
