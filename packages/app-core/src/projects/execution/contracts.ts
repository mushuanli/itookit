import type { KernelAdaptersRuntimeOptions } from '@itookit/kernel-adapters';
import type { RemoteFileConnection, ProjectRemoteMount } from '../remote-mounts';

/** Structural support is separate from project grants and connection health. */
export interface ExecutionCapabilities {
    serverId: string | null;
    process: { exec: boolean };
    terminal: { pty: boolean };
    executionModel: 'none' | 'trusted-cooperative-host' | 'sandbox';
    workspaceConsistency: 'none' | 'cooperative' | 'isolated';
    readOnlyEnforcement: 'none' | 'best-effort' | 'kernel-enforced';
}
export interface ProjectExecutionBinding {
    version: 1;
    connectionId: string;
    serverId: string;
    requiredIsolation: 'trusted-cooperative-host' | 'sandbox';
    authorizationRevision: string;
    mode: 'managed-copy';
}
export type ProjectExecutionContext = Awaited<ReturnType<NonNullable<KernelAdaptersRuntimeOptions['fileContextForSession']>>>;
export interface ProjectExecutionProvider {
    /** Return one consistent file/process workspace; never attach processes to the original project view. */
    acquire(input: {
        projectId: string; sessionId: string; scopeId?: string;
        binding: ProjectExecutionBinding;
        connection: Omit<RemoteFileConnection, 'alias'>;
        mounts: readonly ProjectRemoteMount[];
    }): Promise<ProjectExecutionContext>;
}

export type ProjectExecutionTarget = Pick<ProjectExecutionBinding, 'connectionId' | 'serverId' | 'requiredIsolation'>;
export interface ExecutionBindingSnapshot { raw: string | null; binding: ProjectExecutionBinding | null }
/** Persistence mechanism; callers own authorization policy and CAS retry decisions. */
export interface ExecutionBindingStore {
    read(projectId: string): Promise<ExecutionBindingSnapshot>;
    write(projectId: string, expected: string | null, binding: ProjectExecutionBinding | null): Promise<void>;
}

/** The use case reads only connection identity and currently granted directories. */
export interface ProjectExecutionSources {
    list(projectId: string): ProjectRemoteMount[];
    connection(connectionId: string): Omit<RemoteFileConnection, 'alias'>;
    executionCapabilities(connectionId: string): Promise<ExecutionCapabilities>;
}
