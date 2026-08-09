import type {
    ILLMService,
    ISkillService,
    IToolService,
    ITTYDriver,
    SkillDefinition,
} from '@itookit/common';
import type { IDeviceDriver } from '@itookit/stdio';
import { BUILTIN_TOOLS, ToolDeviceDriver } from '@itookit/tools';
import { LLMServiceAdapter } from '../llm/llm-service-adapter';
import { SkillDeviceDriver } from '../skill/skill-device-driver';
import { createLoadSkillHandler, loadSkillDefinition, loadSkillMeta } from '../tool/load-skill';
import { createShellSessionHandler, shellSessionDefinition, shellSessionMeta } from '../tty/shell-session';
import { createTtyCloseHandler, ttyCloseDefinition, ttyCloseMeta } from '../tty/tty-close';
import { createTtyWriteHandler, ttyWriteDefinition, ttyWriteMeta } from '../tty/tty-write';
import { TTYSessionManager } from '../tty/session-manager';
import { CoreutilsHarnessPlugin } from '../plugin/coreutils-harness-plugin';
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

export interface CoreutilsRuntimeOptions {
    llmDriver: IDeviceDriver;
    ttyDriver?: ITTYDriver;
    runMode?: 'harness' | 'kernel';
    skillSource?: SkillSource;
    skillToolHandlerFactory?: SkillToolHandlerFactory;
}

export interface CoreutilsRuntime {
    llmService: ILLMService;
    toolService: IToolService;
    skillService: ISkillService;
    toolDriver: ToolDeviceDriver;
    skillDriver: SkillDeviceDriver;
    sessions: SessionCapabilityRegistry;
    plugin: CoreutilsHarnessPlugin;
    disposeSession(sessionId: string): Promise<void>;
    dispose(): Promise<void>;
}

export async function createCoreutilsRuntime(options: CoreutilsRuntimeOptions): Promise<CoreutilsRuntime> {
    const llmService = new LLMServiceAdapter(options.llmDriver, options.runMode ?? 'harness');
    const registry = new CoreutilsSessionRegistry(options);
    const legacy = await registry.getLegacyScope();
    const effects = createEffects(llmService, registry, Boolean(options.ttyDriver));
    return {
        llmService,
        toolService: legacy.toolService,
        skillService: legacy.skillService,
        toolDriver: legacy.toolDriver,
        skillDriver: legacy.skillDriver,
        sessions: registry,
        plugin: new CoreutilsHarnessPlugin({
            effects,
            programs: [new ApprovedEffectProgram()],
            onSessionClosed: sessionId => registry.disposeSession(sessionId),
        }),
        disposeSession: sessionId => registry.disposeSession(sessionId),
        dispose: () => registry.dispose(),
    };
}

interface CoreutilsScope extends SessionCapabilityScope {
    toolDriver: ToolDeviceDriver;
    skillDriver: SkillDeviceDriver;
    ttySessions?: TTYSessionManager;
}

class CoreutilsSessionRegistry implements SessionCapabilityRegistry {
    private readonly scopes = new Map<string, Promise<CoreutilsScope>>();
    private readonly skillDefinitions = new Map<string, SkillDefinition>();
    private readonly hydrated = new Set<string>();

    constructor(private readonly options: CoreutilsRuntimeOptions) {}

    get(sessionId: string): Promise<CoreutilsScope> {
        const current = this.scopes.get(sessionId);
        if (current) return current;
        const created = this.createScope();
        this.scopes.set(sessionId, created);
        return created;
    }

    getLegacyScope(): Promise<CoreutilsScope> {
        return this.get('legacy');
    }

    async getForContext(
        context: import('@itookit/harness').EffectExecutionContext,
    ): Promise<CoreutilsScope> {
        const scope = await this.get(context.sessionId);
        if (this.hydrated.has(context.sessionId)) return scope;
        const saved = await context.sessionState?.get('coreutils.skills.loaded');
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

    private async createScope(): Promise<CoreutilsScope> {
        const toolDriver = new ToolDeviceDriver(BUILTIN_TOOLS);
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
): CoreutilsScope {
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
    registry: CoreutilsSessionRegistry,
    ttyEnabled: boolean,
): import('@itookit/harness').EffectAdapter[] {
    const tools = async (context: import('@itookit/harness').EffectExecutionContext) =>
        (await registry.getForContext(context)).toolService;
    const skills = async (context: import('@itookit/harness').EffectExecutionContext) =>
        (await registry.getForContext(context)).skillService;
    const effects: import('@itookit/harness').EffectAdapter[] = [
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
    context: import('@itookit/harness').EffectExecutionContext,
): Promise<void> {
    if (!context.sessionState) return;
    const key = 'coreutils.skills.loaded';
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
