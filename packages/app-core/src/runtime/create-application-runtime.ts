import { createInfrastructure } from './infrastructure';
import { createConversationSystem, disposeConversationSystem } from './conversation-system';
import { SessionUnfinishedTasksError } from '../vfs/errors';
import { recoverSessionsWithLeases } from './session-recovery';
import type { IStorageBackend, MountOptions } from '@itookit/vfs-core';
import { LLMDeviceDriver, type CodexAppServerTransport } from '@itookit/device-llm';
import { t, traceBoot, type ILLMLogger } from '@itookit/common';
import {
    SessionRepository, SessionDirectoryStorageResolver,
    VFSAgentService, FlowEngine, FlowDefinitionStore, seedDefaultFlows,
} from '@itookit/llm-session';
import { createKernelRuntime, type HeadlessKernelRuntime, type CreateKernelRuntimeOptions } from './create-kernel-runtime';
import { RunCatalog } from '../run/run-catalog';
import { SessionFilesService } from '../vfs/session-files';
import { DirectoryMountService, type DirectorySourceProvider } from '../vfs/directory-mounts';
import { createSessionAttachmentMounts } from '../vfs/session-attachments';
import { acquireSessionProcessContext, type SessionProcessFactory } from '../vfs/session-process-context';
import { workspaceRoot } from '../session/workspace-paths';
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
    const cleanupFns: Array<() => void | Promise<void>> = [];
    const sourceCleanupFns: Array<() => void | Promise<void>> = [];
    const logStep = (label: string) => { console.log(`[Boot] ${label}`); options.onProgress?.(label); };
    try {
        const { vfs, systemFS, llmDriver, logIO, closeCodexTransport } = await createInfrastructure(options);
        sourceCleanupFns.push(() => vfs.dispose());
        if (closeCodexTransport) cleanupFns.push(closeCodexTransport);

        // ── 3. Core services ───────────────────────────────────────────────────────

        logStep(t('boot.coreServices'));
        const agentService   = new VFSAgentService(await vfs.openFileSystem(workspaceRoot('agents')), llmDriver);
        const sessionRepository     = new SessionRepository(await vfs.openFileSystem('/'));
        const flowEngine     = new FlowEngine(await vfs.openFileSystem(workspaceRoot('flows')));
        await traceBoot('flowEngine.init', () => flowEngine.init());

        // Durable Kernel with application-owned capability injection.
        const ts = performance.now();
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
                        throw new SessionUnfinishedTasksError(id);
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
            llmDriver.onChange(() => { syncSkillsToKernel(llmDriver, kernel).catch(error => console.warn('[Skills] sync failed', error)); })
        );

        logIO('core services');

        logStep(t('boot.llmEngine'));
        const { sessionManager, commandBus } = await traceBoot('initializeConversationSystem',
            () => createConversationSystem({ vfs, agentService, sessionRepository, flowEngine, kernel }));
        cleanupFns.push(() => disposeConversationSystem());

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
