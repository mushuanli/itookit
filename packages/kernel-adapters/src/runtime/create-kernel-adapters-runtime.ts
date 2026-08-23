import type {
    ILLMService,
    ISkillService,
    IToolService,
    ITTYDriver,
    SkillDefinition,
    ToolVFSContext,
} from '@itookit/common';
import type { IDeviceDriver } from '@itookit/vfs-core';
import { BUILTIN_TOOLS, ToolDeviceDriver } from '@itookit/tools';
import type { INativeShell, Tool } from '@itookit/tools';
import { LLMServiceAdapter } from '../llm/llm-service-adapter';
import { SkillDeviceDriver } from '../skill/skill-device-driver';
import { createLoadSkillHandler, loadSkillDefinition, loadSkillMeta } from '../tool/load-skill';
import { createShellSessionHandler, shellSessionDefinition, shellSessionMeta } from '../tty/shell-session';
import { createTtyCloseHandler, ttyCloseDefinition, ttyCloseMeta } from '../tty/tty-close';
import { createTtyWriteHandler, ttyWriteDefinition, ttyWriteMeta } from '../tty/tty-write';
import { TTYSessionManager } from '../tty/session-manager';
import { KernelAdaptersPlugin } from '../plugin/kernel-adapters-plugin';
import { LlmChatEffectAdapter } from '../effects/llm-chat-effect';
import { ToolCallEffectAdapter } from '../effects/tool-call-effect';
import { BashEffectAdapter } from '../effects/bash-effect';
import { SkillLoadEffectAdapter } from '../effects/skill-load-effect';
import { TtyEffectAdapter } from '../effects/tty-effect';
import type {
    SessionCapabilityRegistry,
    SessionCapabilityScope,
    SkillSource,
    SkillToolHandlerFactory,
} from '../ports/capabilities';
import { ApprovedEffectProgram } from '../programs/approved-effect-program';
import { ExecProgram } from '../programs/exec-program';

export interface KernelAdaptersRuntimeOptions {
    llmDriver: IDeviceDriver;
    ttyDriver?: ITTYDriver;
    runMode?: 'kernel' | 'kernel';
    skillSource?: SkillSource;
    skillToolHandlerFactory?: SkillToolHandlerFactory;
    /** Platform-owned filesystem boundary inherited by every session scope. */
    vfsContext?: ToolVFSContext;
    /** Platform-owned process runner inherited by every session scope. */
    nativeShell?: INativeShell;
    /** Additional application tools registered in every isolated session scope. */
    additionalTools?: Tool[];
}

export interface KernelAdaptersRuntime {
    llmService: ILLMService;
    toolService: IToolService;
    skillService: ISkillService;
    toolDriver: ToolDeviceDriver;
    skillDriver: SkillDeviceDriver;
    sessions: SessionCapabilityRegistry;
    plugin: KernelAdaptersPlugin;
    disposeSession(sessionId: string): Promise<void>;
    dispose(): Promise<void>;
}

export async function createKernelAdaptersRuntime(options: KernelAdaptersRuntimeOptions): Promise<KernelAdaptersRuntime> {
    const llmService = new LLMServiceAdapter(options.llmDriver, options.runMode ?? 'kernel');
    const registry = new KernelAdaptersSessionRegistry(options);
    const legacy = await registry.getLegacyScope();
    const effects = createEffects(llmService, registry, Boolean(options.ttyDriver));
    return {
        llmService,
        toolService: legacy.toolService,
        skillService: legacy.skillService,
        toolDriver: legacy.toolDriver,
        skillDriver: legacy.skillDriver,
        sessions: registry,
        plugin: new KernelAdaptersPlugin({
            effects,
            programs: [new ApprovedEffectProgram(), new ExecProgram()],
            onSessionClosed: sessionId => registry.disposeSession(sessionId),
        }),
        disposeSession: sessionId => registry.disposeSession(sessionId),
        dispose: () => registry.dispose(),
    };
}

interface KernelAdaptersScope extends SessionCapabilityScope {
    toolDriver: ToolDeviceDriver;
    skillDriver: SkillDeviceDriver;
    ttySessions?: TTYSessionManager;
}

class KernelAdaptersSessionRegistry implements SessionCapabilityRegistry {
    private readonly scopes = new Map<string, Promise<KernelAdaptersScope>>();
    private readonly skillDefinitions = new Map<string, SkillDefinition>();
    private readonly hydrated = new Set<string>();

    constructor(private readonly options: KernelAdaptersRuntimeOptions) {}

    get(sessionId: string): Promise<KernelAdaptersScope> {
        const current = this.scopes.get(sessionId);
        if (current) return current;
        const created = this.createScope();
        this.scopes.set(sessionId, created);
        return created;
    }

    getLegacyScope(): Promise<KernelAdaptersScope> {
        return this.get('legacy');
    }

    async getForContext(
        context: import('@itookit/durable-kernel').EffectExecutionContext,
    ): Promise<KernelAdaptersScope> {
        const scope = await this.get(context.sessionId);
        if (this.hydrated.has(context.sessionId)) return scope;
        const saved = await context.sessionState?.get('kernel-adapters.skills.loaded');
        const ids = Array.isArray(saved?.value) ? saved.value.filter(value => typeof value === 'string') : [];
        for (const id of ids) {
            const result = await scope.skillService.loadSkill(id);
            if (!result.success) throw new Error(result.error ?? `Failed to restore Skill: ${id}`);
        }
        this.hydrated.add(context.sessionId);
        return scope;
    }

    async disposeSession(sessionId: string): Promise<void> {
        const scope = this.scopes.get(sessionId);
        this.scopes.delete(sessionId);
        this.hydrated.delete(sessionId);
        if (scope) await (await scope).dispose();
    }

    async dispose(): Promise<void> {
        const scopes = [...this.scopes.values()];
        this.scopes.clear();
        this.hydrated.clear();
        await Promise.all(scopes.map(async scope => (await scope).dispose()));
    }

    private async createScope(): Promise<KernelAdaptersScope> {
        const toolDriver = new ToolDeviceDriver([
            ...BUILTIN_TOOLS,
            ...(this.options.additionalTools ?? []),
        ]);
        if (this.options.vfsContext) toolDriver.setVFSContext(this.options.vfsContext);
        if (this.options.nativeShell) toolDriver.setNativeShell(this.options.nativeShell);
        const skillDriver = new SkillDeviceDriver({
            registry: this.skillDefinitions,
            source: this.options.skillSource,
            toolHandlerFactory: this.options.skillToolHandlerFactory,
        });
        skillDriver.setToolService(toolDriver.getService());
        const ttySessions = registerCoreTools(toolDriver, skillDriver.getService(), this.options.ttyDriver);
        await toolDriver.init();
        return createScope(toolDriver, skillDriver, ttySessions);
    }
}

function createScope(
    toolDriver: ToolDeviceDriver,
    skillDriver: SkillDeviceDriver,
    ttySessions?: TTYSessionManager,
): KernelAdaptersScope {
    return {
        toolDriver,
        skillDriver,
        ttySessions,
        toolService: toolDriver.getService(),
        skillService: skillDriver.getService(),
        async dispose() {
            ttySessions?.abortAll();
            await Promise.all([toolDriver.dispose(), skillDriver.dispose()]);
        },
    };
}

function createEffects(
    llm: ILLMService,
    registry: KernelAdaptersSessionRegistry,
    ttyEnabled: boolean,
): import('@itookit/durable-kernel').EffectAdapter[] {
    const tools = async (context: import('@itookit/durable-kernel').EffectExecutionContext) =>
        (await registry.getForContext(context)).toolService;
    const skills = async (context: import('@itookit/durable-kernel').EffectExecutionContext) =>
        (await registry.getForContext(context)).skillService;
    const effects: import('@itookit/durable-kernel').EffectAdapter[] = [
        new LlmChatEffectAdapter(llm),
        new ToolCallEffectAdapter(tools),
        new BashEffectAdapter(tools),
        new SkillLoadEffectAdapter(skills, persistLoadedSkill),
    ];
    if (ttyEnabled) effects.push(new TtyEffectAdapter(tools));
    return effects;
}

async function persistLoadedSkill(
    result: import('@itookit/common').SkillLoadResult,
    context: import('@itookit/durable-kernel').EffectExecutionContext,
): Promise<void> {
    if (!context.sessionState) return;
    const key = 'kernel-adapters.skills.loaded';
    for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await context.sessionState.get(key);
        const current = stringArray(saved?.value);
        if (current.includes(result.skillId)) return;
        try {
            await context.sessionState.set(key, [...current, result.skillId], saved?.version ?? null);
            return;
        } catch (error) {
            if (attempt === 2) throw error;
        }
    }
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function registerCoreTools(
    tools: ToolDeviceDriver,
    skills: ISkillService,
    tty?: ITTYDriver,
): TTYSessionManager | undefined {
    tools.registerTool(loadSkillMeta, loadSkillDefinition, createLoadSkillHandler(skills));
    if (!tty) return undefined;
    const sessions = new TTYSessionManager();
    tools.registerTool(shellSessionMeta, shellSessionDefinition, createShellSessionHandler(tty, sessions));
    tools.registerTool(ttyWriteMeta, ttyWriteDefinition, createTtyWriteHandler(sessions));
    tools.registerTool(ttyCloseMeta, ttyCloseDefinition, createTtyCloseHandler(sessions));
    return sessions;
}
