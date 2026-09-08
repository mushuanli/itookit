import { coordinateSkillEffect, runSessionSkillOperation, invalidateSessionSkillOperations, reopenSessionSkillOperations, closeSessionSkillOperations } from '../skill/operation-queue';
import { parseLoadedSkillIds } from '../skill/loaded-state';
import { createUnloadSkillHandler, unloadSkillDefinition, unloadSkillMeta } from '../tool/unload-skill';
import { SkillUnloadEffectAdapter } from '../effects/skill-unload-effect';
import { rememberLoadedSkill } from '../skill/loaded-state';
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
    /** Acquired independently for each real Session, before any tool can run. */
    fileContextForSession?: (sessionId: string) => Promise<{
        vfs: ToolVFSContext;
        cwd: string;
        release(): Promise<void>;
        nativeShell?: INativeShell;
        ttyDriver?: ITTYDriver;
    }>;
    llmDriver: IDeviceDriver;
    configureSession?: (sessionId: string, scope: SessionCapabilityScope & { toolDriver: ToolDeviceDriver }) => Promise<void> | void;
    runMode?: 'kernel';
    skillSource?: SkillSource;
    /** Create a source using only the acquired Session file view. */
    skillSourceForSession?: (files: { vfs: ToolVFSContext; cwd: string }) => SkillSource;
    skillToolHandlerFactory?: SkillToolHandlerFactory;
    /** Additional application tools registered in every isolated session scope. */
    additionalTools?: Tool[];
}

export interface KernelAdaptersRuntime {
    llmService: ILLMService;
    toolCatalog: Pick<IToolService, 'getToolDefinitions' | 'getToolMeta'>;
    skillCatalog: Pick<ISkillService, 'getSkillNames' | 'saveSkill' | 'deleteSkill'>;
    sessions: SessionCapabilityRegistry;
    plugin: KernelAdaptersPlugin;
    disposeSession(sessionId: string): Promise<void>;
    dispose(): Promise<void>;
}

export async function createKernelAdaptersRuntime(options: KernelAdaptersRuntimeOptions): Promise<KernelAdaptersRuntime> {
    const llmService = new LLMServiceAdapter(options.llmDriver, options.runMode ?? 'kernel');
    const definitions = new Map<string, SkillDefinition>();
    const registry = new KernelAdaptersSessionRegistry(options, definitions);
    // Metadata only: no executable tool/skill service escapes through the catalog.
    const catalogSkills = new SkillDeviceDriver({ registry: definitions });
    const catalogTools = new ToolDeviceDriver([...BUILTIN_TOOLS, ...(options.additionalTools ?? [])]);
    registerCoreTools(catalogTools, catalogSkills);
    await catalogTools.init();
    const effects = createEffects(llmService, registry, Boolean(options.fileContextForSession));
    return {
        llmService,
        toolCatalog: {
            getToolDefinitions: () => catalogTools.getToolDefinitions(),
            getToolMeta: id => catalogTools.getToolMeta(id),
        },
        skillCatalog: {
            getSkillNames: () => catalogSkills.getSkillNames(),
            saveSkill: skill => catalogSkills.saveSkill(skill),
            deleteSkill: id => registry.deleteSkill(id, catalogSkills),
        },
        sessions: registry,
        plugin: new KernelAdaptersPlugin({
            effects,
            programs: [new ApprovedEffectProgram(), new ExecProgram()],
            onSessionClosed: sessionId => registry.disposeSession(sessionId),
        }),
        disposeSession: sessionId => registry.disposeSession(sessionId),
        dispose: async () => { await registry.dispose(); await catalogTools.dispose(); await catalogSkills.dispose(); },
    };
}

interface KernelAdaptersScope extends SessionCapabilityScope {
    toolDriver: ToolDeviceDriver;
    skillDriver: SkillDeviceDriver;
    ttySessions?: TTYSessionManager;
}

class KernelAdaptersSessionRegistry implements SessionCapabilityRegistry {
    private closed = false;
    private readonly closing = new Map<string, Promise<void>>();
    private readonly scopes = new Map<string, Promise<KernelAdaptersScope>>();
    private readonly hydrated = new Set<string>();
    private readonly hydrating = new Map<string, Promise<KernelAdaptersScope>>();

    constructor(private readonly options: KernelAdaptersRuntimeOptions,
        private readonly skillDefinitions: Map<string, SkillDefinition>) {}

    get(sessionId: string): Promise<KernelAdaptersScope> {
        if (this.closed) return Promise.reject(new Error('Session capability registry is closed'));
        if (this.closing.has(sessionId)) return Promise.reject(new Error('Session capability scope is closing'));
        const current = this.scopes.get(sessionId);
        if (current) return current;
        const created = this.createScope(sessionId);
        this.scopes.set(sessionId, created);
        void created.catch(() => { if (this.scopes.get(sessionId) === created) this.scopes.delete(sessionId); });
        return created;
    }

    async deleteSkill(id: string, catalog: SkillDeviceDriver): Promise<void> {
        if (this.closed) throw new Error('Session capability registry is closed');
        for (const pending of this.scopes.values()) await (await pending).skillService.deleteSkill(id);
        await catalog.deleteSkill(id);
    }

    async getForContext(
        context: import('@itookit/durable-kernel').EffectExecutionContext,
    ): Promise<KernelAdaptersScope> {
        const saved = await context.sessionState?.get('kernel-adapters.skills.loaded');
        return this.restore(context.sessionId, saved?.value);
    }

    restore(sessionId: string, loadedSkillIds: unknown): Promise<KernelAdaptersScope> {
        const pending = this.hydrating.get(sessionId);
        if (pending) return pending;
        const restored = this.restoreScope(sessionId, loadedSkillIds);
        this.hydrating.set(sessionId, restored);
        void restored.finally(() => {
            if (this.hydrating.get(sessionId) === restored) this.hydrating.delete(sessionId);
        }).catch(() => undefined);
        return restored;
    }

    private async restoreScope(sessionId: string, value: unknown): Promise<KernelAdaptersScope> {
        const opening = this.get(sessionId);
        const identity = this.scopes.get(sessionId);
        const scope = await opening;
        if (this.closed || this.scopes.get(sessionId) !== identity) throw new Error('Session scope changed during Skill restoration');
        if (this.hydrated.has(sessionId)) return scope;
        for (const id of parseLoadedSkillIds(value)) {
            if (scope.skillService.getSkill(id)?.disableModelInvocation) throw new Error(`Skill cannot be restored for model invocation: ${id}`);
            const result = await scope.skillService.loadSkill(id);
            if (!result.success) throw new Error(result.error ?? `Failed to restore Skill: ${id}`);
        }
        if (this.closed || this.scopes.get(sessionId) !== identity) throw new Error('Session scope changed during Skill restoration');
        this.hydrated.add(sessionId);
        return scope;
    }

    async disposeSession(sessionId: string): Promise<void> {
        const pending = this.closing.get(sessionId);
        if (pending) return pending;
        invalidateSessionSkillOperations(this, sessionId);
        const scope = this.scopes.get(sessionId);
        this.scopes.delete(sessionId);
        this.hydrated.delete(sessionId);
        this.hydrating.delete(sessionId);
        if (!scope) { reopenSessionSkillOperations(this, sessionId); return; }
        const close = scope.then(value => value.dispose(), () => {});
        this.closing.set(sessionId, close);
        try { await close; } finally { this.closing.delete(sessionId); reopenSessionSkillOperations(this, sessionId); }
    }

    async dispose(): Promise<void> {
        this.closed = true;
        closeSessionSkillOperations(this);
        const scopes = [...this.scopes.values()];
        this.scopes.clear();
        this.hydrated.clear();
        this.hydrating.clear();
        const results = await Promise.allSettled([...this.closing.values(), ...scopes.map(async scope => {
            const value = await scope.catch(() => undefined);
            await value?.dispose();
        })]);
        const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
        if (errors.length) throw new AggregateError(errors, 'Failed to close Session capabilities');
    }

    private async createScope(sessionId: string): Promise<KernelAdaptersScope> {
        const files = this.options.fileContextForSession
            ? await this.options.fileContextForSession(sessionId) : undefined;
        const toolDriver = new ToolDeviceDriver([
            ...BUILTIN_TOOLS,
            ...(this.options.additionalTools ?? []),
        ]);
        if (files) toolDriver.setFileContext(files.vfs, files.cwd);
        else toolDriver.setFileContext({
            readFile: async () => { throw new Error('Session has no file capability'); },
            writeFile: async () => { throw new Error('Session has no file capability'); },
            listFiles: async () => { throw new Error('Session has no file capability'); },
        }, '/');
        const nativeShell = files?.nativeShell;
        if (nativeShell) toolDriver.setNativeShell(nativeShell);
        let source: SkillSource | undefined;
        try { source = files && this.options.skillSourceForSession
            ? this.options.skillSourceForSession(files) : this.options.skillSource; }
        catch (error) { await files?.release(); await toolDriver.dispose(); throw error; }
        const skillDriver = new SkillDeviceDriver({
            registry: this.skillDefinitions,
            source,
            readFile: files ? path => files.vfs.readFile(path) : undefined,
            toolHandlerFactory: this.options.skillToolHandlerFactory,
        });
        skillDriver.setToolService(toolDriver.getService());
        const ttySessions = registerCoreTools(toolDriver, skillDriver.getService(), files?.ttyDriver);
        try {
            await toolDriver.init();
            if (files && this.options.skillSourceForSession) await skillDriver.getService().setCwd(files.cwd);
        }
        catch (error) { await files?.release(); await toolDriver.dispose(); await skillDriver.dispose(); throw error; }
        const scope = createScope(toolDriver, skillDriver, ttySessions);
        const dispose = scope.dispose.bind(scope);
        let disposed = false;
        scope.dispose = async () => {
            if (disposed) return;
            disposed = true;
            try { await dispose(); } finally { await files?.release(); }
        };
        try { await this.options.configureSession?.(sessionId, scope); }
        catch (error) { await scope.dispose(); throw error; }
        return scope;
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
        new ToolCallEffectAdapter(async (context, request) => {
            const scope = await registry.get(context.sessionId);
            const meta = scope.toolService.getToolMeta(request.toolId);
            if (meta?.skillUnloaderArgKey) return scope.toolService;
            if (meta?.skillLoaderArgKey) return tools(context);
            return runSessionSkillOperation(registry, context.sessionId, () => tools(context));
        }, async (skillId, context) => {
            const service = await skills(context);
            const skill = service.getLoadedSkills().find(item => item.id === skillId);
            if (!skill || skill.disableModelInvocation) return;
            const toolService = await tools(context);
            const definitions = toolService.getToolDefinitions();
            const boundTools = skill.tools.flatMap(binding => {
                const meta = toolService.getToolMeta(binding.toolId);
                const name = binding.definition.function?.name ?? binding.definition.name ?? binding.toolId;
                const definition = definitions.find(item => (item.function?.name ?? item.name) === name);
                return meta?.enabled && definition
                    ? [{ toolId: binding.toolId, definition: structuredClone(definition), external: meta.sideEffect === 'external' }]
                    : [];
            });
            const snapshot = { skillId, compactInstructions: skill.compact?.rawContent ?? '', tools: boundTools };
            await persistLoadedSkill({ skillId, success: true, toolIds: [] }, context);
            return snapshot;
        }),
        new BashEffectAdapter(context => runSessionSkillOperation(registry, context.sessionId, () => tools(context))),
        new SkillLoadEffectAdapter(skills, persistLoadedSkill),
        new SkillUnloadEffectAdapter(async context => (await registry.get(context.sessionId)).skillService),
    ];
    if (ttyEnabled) effects.push(new TtyEffectAdapter(context => runSessionSkillOperation(registry, context.sessionId, () => tools(context))));
    return effects.map(effect => coordinateSkillEffect(effect, registry));
}

async function persistLoadedSkill(
    result: import('@itookit/common').SkillLoadResult,
    context: import('@itookit/durable-kernel').EffectExecutionContext,
): Promise<void> {
    await rememberLoadedSkill(result.skillId, context.sessionState);
}


function registerCoreTools(
    tools: ToolDeviceDriver,
    skills: ISkillService,
    tty?: ITTYDriver,
): TTYSessionManager | undefined {
    tools.registerTool(loadSkillMeta, loadSkillDefinition, createLoadSkillHandler(skills));
    tools.registerTool(unloadSkillMeta, unloadSkillDefinition, createUnloadSkillHandler(skills));
    if (!tty) return undefined;
    const sessions = new TTYSessionManager();
    tools.registerTool(shellSessionMeta, shellSessionDefinition, createShellSessionHandler(tty, sessions));
    tools.registerTool(ttyWriteMeta, ttyWriteDefinition, createTtyWriteHandler(sessions));
    tools.registerTool(ttyCloseMeta, ttyCloseDefinition, createTtyCloseHandler(sessions));
    return sessions;
}
