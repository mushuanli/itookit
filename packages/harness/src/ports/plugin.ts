import type {
    DurableTaskProgram,
    EffectAdapter,
    SessionStorageResolver,
    WorkspaceAdapter,
} from '../domain/types';

export interface HarnessRegistration {
    registerProgram(program: DurableTaskProgram): void;
    registerEffect(adapter: EffectAdapter): void;
    registerStorageResolver(resolver: SessionStorageResolver): void;
    registerWorkspace(adapter: WorkspaceAdapter): void;
}

export interface HarnessPlugin {
    readonly id: string;
    readonly version: string;
    install(registration: HarnessRegistration): void | Promise<void>;
    onSessionClosed?(sessionId: string): void | Promise<void>;
}
