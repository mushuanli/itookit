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
    AgentModelRoles,
    AgentBudgetLimits,
    AgentLoopConfig,
    DeviceContext,
} from '@itookit/common';
import { AgentLoopExecutor } from '../executor/agent-loop-executor';
import { SubAgentRouter } from '../executor/sub-agent-router';
import { loadSkillMeta, loadSkillDefinition, createLoadSkillHandler } from '../tools/load-skill';
import { delegateTaskMeta, delegateTaskDefinition, createDelegateTaskHandler } from '../tools/delegate-task';

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

    private modelRoles: AgentModelRoles = { primary: '' };
    private budgetLimits: AgentBudgetLimits = { ...DEFAULT_BUDGET };
    private loopConfig: AgentLoopConfig = { ...DEFAULT_LOOP_CONFIG };
    private costModel: CostModel | undefined = undefined;

    private changeListeners: Array<() => void> = [];

    // ── Dependency injection ──

    setServices(services: { llm: ILLMService; tool: IToolService; skill: ISkillService }): void {
        this.llm = services.llm;
        this.toolService = services.tool;
        this.skillService = services.skill;
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
                // Derive per-token pricing from the connection's model metadata,
                // falling back to Sonnet-class defaults if unavailable.
                const modelInfo = conn.availableModels?.find((m) => m.id === conn.model);
                if (modelInfo?.inputPricePerMillion !== undefined) {
                    this.costModel = {
                        perInputToken: modelInfo.inputPricePerMillion / 1_000_000,
                        perOutputToken: (modelInfo.outputPricePerMillion ?? modelInfo.inputPricePerMillion * 5) / 1_000_000,
                    };
                }
            }
        }
    }

    async dispose(): Promise<void> {
        this.runtime?.abort();
        this.runtime = null;
        this.router = null;
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
            );
        }
        return this.runtime;
    }

    private notifyChange(): void {
        for (const l of this.changeListeners) l();
    }
}
