import { Kernel, type RecoveryOptions, type SessionStorageResolver } from '@itookit/durable-kernel';
import {
    createKernelAdaptersRuntime,
    type KernelAdaptersRuntime,
    type KernelAdaptersRuntimeOptions,
} from '@itookit/kernel-adapters';
import {
    createBuiltinDagPluginRegistry,
    DagPluginRegistry,
    registerDurablePrograms,
    resolveFlowTaskWorkspace,
} from '@itookit/llm-flow';
import type { IFileSystem } from '@itookit/vfs-core';
import { createMemoryTools } from './memory-tools';
import { SessionMemoryProvider, SharedMemoryStore } from '@itookit/llm-session';

export interface CreateKernelRuntimeOptions {
    /** System VFS view used for the Kernel catalog and storage binding. */
    systemFS: IFileSystem;
    llmDriver: KernelAdaptersRuntimeOptions['llmDriver'];
    storageResolver: SessionStorageResolver;
    maxConcurrent?: number;
    maxConcurrentEffects?: number;
    fileContextForSession?: KernelAdaptersRuntimeOptions['fileContextForSession'];
    scopeForEffect?: KernelAdaptersRuntimeOptions['scopeForEffect'];
    fileContextForScope?: KernelAdaptersRuntimeOptions['fileContextForScope'];
    configureSession?: KernelAdaptersRuntimeOptions['configureSession'];
    skillSource?: KernelAdaptersRuntimeOptions['skillSource'];
    skillSourceForSession?: KernelAdaptersRuntimeOptions['skillSourceForSession'];
    skillToolHandlerFactory?: KernelAdaptersRuntimeOptions['skillToolHandlerFactory'];
    additionalTools?: KernelAdaptersRuntimeOptions['additionalTools'];
    dagPlugins?: DagPluginRegistry;
    /** Register the shared Durable programs before initialize. Defaults to true. */
    registerPrograms?: boolean;
    /** Recover persisted Sessions after initialize. Defaults to `{}`. Pass false to skip. */
    recover?: RecoveryOptions | boolean;
    /** Runs after initialize/registerPrograms and before recover. */
    beforeRecover?: (runtime: HeadlessKernelRuntime) => void | Promise<void>;
}

export interface HeadlessKernelRuntime extends KernelAdaptersRuntime {
    kernel: Kernel;
    dagPlugins: DagPluginRegistry;
    memory: SessionMemoryProvider;
}

/**
 * Shared headless Kernel composition used by app-shell (Web/Tauri) and CLI.
 * Hosts inject platform file/process/skill capabilities; this function owns the
 * durable-kernel + kernel-adapters wiring and Durable program registration.
 */
export async function createKernelRuntime(
    options: CreateKernelRuntimeOptions,
): Promise<HeadlessKernelRuntime> {
    const dagPlugins = options.dagPlugins ?? createBuiltinDagPluginRegistry();
    const sharedMemory = new SharedMemoryStore(options.systemFS);
    await sharedMemory.init();
    const adapters = await createKernelAdaptersRuntime({
        llmDriver: options.llmDriver,
        runMode: 'kernel',
        fileContextForSession: options.fileContextForSession,
        scopeForEffect: options.scopeForEffect ?? (options.fileContextForScope ? async context => {
            const session = await kernel.openSession(context.sessionId);
            return (await resolveFlowTaskWorkspace(session, context.taskId))?.rootTaskId;
        } : undefined),
        fileContextForScope: options.fileContextForScope,
        configureSession: options.configureSession,
        skillSource: options.skillSource,
        skillSourceForSession: options.skillSourceForSession,
        skillToolHandlerFactory: options.skillToolHandlerFactory,
        additionalTools: options.additionalTools,
        effectTools: createMemoryTools(() => kernel, () => memory),
    });

    const kernel = new Kernel({
        catalog: { fs: options.systemFS, rootPath: '/var/lib/kernel' },
        maxConcurrent: options.maxConcurrent,
        maxConcurrentEffects: options.maxConcurrentEffects,
    });
    const memory = new SessionMemoryProvider(kernel, sharedMemory);
    kernel.registerStorageResolver(options.storageResolver);
    await kernel.use(adapters.plugin);
    if (options.registerPrograms !== false) registerDurablePrograms(kernel);
    await kernel.initialize();

    const runtime = Object.assign(adapters, { kernel, dagPlugins, memory }) as HeadlessKernelRuntime;
    await options.beforeRecover?.(runtime);
    if (options.recover !== false) {
        await kernel.recover(options.recover === true || options.recover === undefined ? {} : options.recover);
    }
    return runtime;
}
