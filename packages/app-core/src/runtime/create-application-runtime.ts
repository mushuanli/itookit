import { recoverSessionsWithLeases } from './session-recovery';
import { createVFS, MemoryBackend, type IStorageBackend, type MountOptions } from '@itookit/vfs-core';
import { LLMDeviceDriver, type CodexAppServerTransport } from '@itookit/device-llm';
import { traceBoot, type ILLMLogger } from '@itookit/common';
import { resolveSessionSkillContext } from '@itookit/kernel-adapters';
import {
    SessionMemoryProvider, SessionRepository, SessionDirectoryStorageResolver,
    VFSAgentService, FlowEngine, FlowDefinitionStore, seedDefaultFlows, initializeConversationSystem, resetSessionManager,
} from '@itookit/llm-session';
import { createKernelRuntime, type HeadlessKernelRuntime, type CreateKernelRuntimeOptions } from './create-kernel-runtime';
import { RunCatalog } from '../run/run-catalog';
import { SessionFilesService } from '../files/session-files';
import { DirectoryMountService, type DirectorySourceProvider } from '../files/directory-mounts';
import { createSessionAttachmentMounts } from '../files/session-attachments';
import { acquireSessionProcessContext, type SessionProcessFactory } from '../files/session-process-context';
import { workspaceRoot } from '../files/workspace-paths';
import { SessionLeaseStore, type SessionOwnerKind } from '../kernel/session-lease';
import { syncSkillsToKernel } from '../kernel/sync-skills';

export interface ApplicationKernelPlatform {
    createSessionProcesses?: SessionProcessFactory;
    configureSession?: CreateKernelRuntimeOptions['configureSession'];
    skillSource?: CreateKernelRuntimeOptions['skillSource'];
    skillSourceForSession?: CreateKernelRuntimeOptions['skillSourceForSession'];
    skillToolHandlerFactory?: CreateKernelRuntimeOptions['skillToolHandlerFactory'];
    configure?(kernel: HeadlessKernelRuntime): void | Promise<void>;
}

export interface ApplicationRuntime {
    vfs: import('@itookit/vfs-core').IVFSManager;
    llmDriver: LLMDeviceDriver;
    agentService: VFSAgentService;
    sessionRepository: SessionRepository;
    flowEngine: FlowEngine;
    sessionFiles: SessionFilesService;
    directoryMounts: DirectoryMountService;
    kernel: HeadlessKernelRuntime;
    sessionManager: import('@itookit/llm-session').SessionManager;
    commandBus: import('@itookit/llm-session').CommandBus;
    runCatalog: RunCatalog;
    dispose(): Promise<void>;
}

export interface ApplicationRuntimeOptions {
    backend: IStorageBackend;
    additionalMounts?: Array<{ path: string; backend: IStorageBackend; options?: MountOptions }>;
    directorySourceProvider?: DirectorySourceProvider;
    configureSessionFiles?(files: SessionFilesService): void | Promise<void>;
    kernelPlatform?: ApplicationKernelPlatform;
    llmLogger?: ILLMLogger;
    codexTransport?: CodexAppServerTransport;
    ownerKind?: SessionOwnerKind;
    onProgress?(message: string): void;
}

/** Host-owned system startup. Contains no DOM, routing or editor initialization. */
export async function createApplicationRuntime(options: ApplicationRuntimeOptions): Promise<ApplicationRuntime> {
    const { backend, additionalMounts, llmLogger } = options;
    const cleanupFns: Array<() => void | Promise<void>> = [];
    const sourceCleanupFns: Array<() => void | Promise<void>> = [];
    const logStep = (label: string) => { console.log(`[Boot] ${label}`); options.onProgress?.(label); };
    try {
        // ── 1. VFS ─────────────────────────────────────────────────────────────────

        logStep('初始化文件系统…');
        const { manager: vfs } = await traceBoot('createVFS', () => createVFS({
            rootBackend: backend,
            additionalMounts: [...(additionalMounts ?? []), { path: '/run', backend: new MemoryBackend() }],
        }));

        sourceCleanupFns.push(() => vfs.dispose());

        // Helper to dump VFS I/O counters (for identifying redundant reads/writes)
        const logIO = (label: string) => {
            try {
                const s = (vfs as any)._engine?.ioStats;
                if (s) console.log(`[Boot]   ↳ IO after ${label}: stat=${s.stat} list=${s.list} read=${s.read} write=${s.write} mkdir=${s.mkdir} delete=${s.delete} rename=${s.rename}`);
                (vfs as any)._engine?.resetIOStats();
            } catch { /* ignore */ }
        };
        logIO('createVFS');


        // ── 2. LLM device driver ───────────────────────────────────────────────────

        logStep('加载 LLM 驱动…');
        const llmDriver = new LLMDeviceDriver(vfs, { llmLogger, codexTransport: options.codexTransport });
        if (options.codexTransport?.close) cleanupFns.push(() => options.codexTransport!.close!());
        let ts = performance.now();
        await traceBoot('llmDriver.init', () => llmDriver.init());
        console.log(`[Boot]   ↳ llmDriver.init: +${(performance.now() - ts).toFixed(0)}ms`);
        vfs.devices.register(llmDriver);
        ts = performance.now();
        await traceBoot('llmDriver.createDeviceNodes', () => llmDriver.createDeviceNodes());
        console.log(`[Boot]   ↳ createDeviceNodes: +${(performance.now() - ts).toFixed(0)}ms`);
        vfs.devices.freeze();
        logIO('LLM driver');


        for (const path of ['/home/admin/chats', '/home/admin/notes', '/home/admin/projects', '/home/admin/.config']) await vfs.openFileSystem(path);

        // ── 3. Core services ───────────────────────────────────────────────────────

        logStep('初始化核心服务…');
        const agentService   = new VFSAgentService(await vfs.openFileSystem(workspaceRoot('agents')), llmDriver);
        const sessionRepository     = new SessionRepository(await vfs.openFileSystem('/'));
        const flowEngine     = new FlowEngine(await vfs.openFileSystem(workspaceRoot('flows')));
        await traceBoot('flowEngine.init', () => flowEngine.init());

        // Durable Kernel with application-owned capability injection.
        ts = performance.now();
        const systemFS = await vfs.openFileSystem('/');
        const systemMounts = createSessionAttachmentMounts(sessionRepository);
        cleanupFns.push(() => systemMounts.dispose());
        const sessionFiles = new SessionFilesService(await vfs.openFileSystem('/'), id => systemMounts.forSession(id));
        await traceBoot('sessionFiles.initialize', () => sessionFiles.initialize());
        sessionFiles.registerSource('admin-home', await vfs.openFileSystem('/home/admin'));
        await options.configureSessionFiles?.(sessionFiles);
        if (options.directorySourceProvider) cleanupFns.push(() => options.directorySourceProvider!.dispose());
        cleanupFns.push(() => sessionFiles.dispose());
        let mountChanged: (id: string) => Promise<void> = async () => {};
        let mountGuard: (id: string) => Promise<void> = async () => {};
        const directoryMounts = new DirectoryMountService(systemFS, sessionFiles, options.directorySourceProvider,
            id => mountGuard(id), id => mountChanged(id));
        cleanupFns.push(() => directoryMounts.dispose());
        await traceBoot('directoryMounts.init', () => directoryMounts.init());
        const kernel: HeadlessKernelRuntime = await traceBoot('createKernelRuntime', () => createKernelRuntime({
            systemFS,
            llmDriver,
            storageResolver: new SessionDirectoryStorageResolver(systemFS),
            maxConcurrent: 20,
            fileContextForSession: id => acquireSessionProcessContext(sessionFiles, id, options.kernelPlatform?.createSessionProcesses,
                () => directoryMounts.processMounts(id)),
            configureSession: options.kernelPlatform?.configureSession,
            skillSource: options.kernelPlatform?.skillSource,
            skillSourceForSession: options.kernelPlatform?.skillSourceForSession,
            skillToolHandlerFactory: options.kernelPlatform?.skillToolHandlerFactory,
            beforeRecover: async runtime => {
                mountChanged = id => runtime.disposeSession(id);
                mountGuard = async id => {
                    let exists = false;
                    for await (const session of runtime.kernel.listSessions()) if (session.id === id) { exists = true; break; }
                    if (exists && (await runtime.kernel.listSessionTasks(id)).some(task => !['succeeded', 'failed', 'cancelled'].includes(task.status))) {
                        throw new Error('会话仍有未结束的 Task，请先结束或取消任务再修改挂载');
                    }
                };
                await traceBoot('syncSkillsToKernel', () => syncSkillsToKernel(llmDriver, runtime));
                await options.kernelPlatform?.configure?.(runtime);
            },
            // Recover Sessions only after this host acquires their lease.
            recover: false,
        }));
        const kernelCore = kernel.kernel;
        const leaseStore = new SessionLeaseStore(systemFS);
        const ownerId = `${options.ownerKind ?? "tauri"}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
        const recovery = await recoverSessionsWithLeases(kernelCore, leaseStore,
            { id: ownerId, kind: options.ownerKind ?? 'tauri' }, 10_000).catch(async error => {
                kernelCore.dispose();
                const errors: unknown[] = [error];
                for (const close of [() => kernelCore.waitIdle(), () => kernel.dispose()]) {
                    try { await close(); } catch (cleanup) { errors.push(cleanup); }
                }
                if (errors.length > 1) throw new AggregateError(errors, 'Application recovery and kernel cleanup failed');
                throw error;
            });
        cleanupFns.push(() => recovery.release());
        cleanupFns.push(() => kernel.dispose());
        cleanupFns.push(async () => { kernelCore.dispose(); await kernelCore.waitIdle(); });
        console.log(`[Boot]   ↳ createKernel: +${(performance.now() - ts).toFixed(0)}ms`);

        // Inject VFS context so file tools work with the virtual filesystem in browser.
        // When node:fs is unavailable, tools fall back to ctx.vfs (ToolVFSContext).
        // File contexts are installed independently in each Session scope before recovery.

        // Keep skills in sync when the user adds / edits / deletes skills in Settings.
        // The initial sync happens before Kernel recovery so restored Skill identities resolve.
        cleanupFns.push(
            llmDriver.onChange(() => { syncSkillsToKernel(llmDriver, kernel).catch(() => {}); })
        );

        logIO('core services');

        logStep('初始化 LLM 引擎…');
        const { sessionManager, commandBus } = await traceBoot('initializeConversationSystem', async () => initializeConversationSystem({
            agentService,
            sessionEngine: sessionRepository,
            promptHistoryFiles: await vfs.openFileSystem('/home/admin/.config/mindos/prompt-history'),
            kernel:             kernel.kernel,
            flowStore:          flowEngine,
            dagPlugins:          kernel.dagPlugins,
            retrieveMemory: new SessionMemoryProvider(kernel.kernel).retrieve,
            resolveSessionContext: (sessionId, userMessage) => resolveSessionSkillContext(kernel.kernel, kernel.sessions, sessionId, userMessage),
            resolveTools: async (sessionId, allowedIds) => {
                const tools = (await kernel.sessions.get(sessionId)).toolService;
                const allowed = new Set(allowedIds);
                return {
                    definitions: tools.getToolDefinitions().filter(definition => {
                        const name = definition.function?.name ?? definition.name;
                        return Boolean(name && allowed.has(name));
                    }),
                    externalIds: allowedIds.filter(id => tools.getToolMeta(id)?.sideEffect === 'external'),
                };
            },
        }));

        cleanupFns.push(() => resetSessionManager());

        const acquireSessionLease = (sessionId: string): Promise<boolean> => recovery.acquireLater(sessionId);
        const unsubscribeSessionLease = sessionManager.onGlobalEvent(event => {
            if (event.type === 'session_registered') void acquireSessionLease(event.payload.sessionId);
        });
        cleanupFns.push(unsubscribeSessionLease);

        // Seed the default essay-review workflow so users have a runnable example.
        await traceBoot('seedDefaultFlows', () => seedDefaultFlows(new FlowDefinitionStore(flowEngine, kernel.dagPlugins)));

        const runCatalog = new RunCatalog(sessionRepository, kernel.kernel);

        let disposed = false;
        const dispose = async () => {
            if (disposed) return;
            disposed = true;
            const errors: unknown[] = [];
            for (const close of [...cleanupFns].reverse().concat([...sourceCleanupFns].reverse())) {
                try { await close(); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(errors, 'Application runtime cleanup failed');
        };
        return { vfs, llmDriver, agentService, sessionRepository, flowEngine, sessionFiles, directoryMounts,
            kernel, sessionManager, commandBus, runCatalog, dispose };
    } catch (error) {
        for (const close of [...cleanupFns].reverse().concat([...sourceCleanupFns].reverse())) {
            try { await close(); } catch (cleanupError) { console.error('[Boot] Cleanup failed', cleanupError); }
        }
        throw error;
    }
}
