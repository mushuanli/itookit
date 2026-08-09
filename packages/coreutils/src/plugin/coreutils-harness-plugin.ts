import type {
    DurableTaskProgram,
    EffectAdapter,
    HarnessPlugin,
    HarnessRegistration,
} from '@itookit/harness';

export interface CoreutilsPluginOptions {
    effects: readonly EffectAdapter[];
    programs?: readonly DurableTaskProgram[];
    onSessionClosed?: (sessionId: string) => void | Promise<void>;
}

export class CoreutilsHarnessPlugin implements HarnessPlugin {
    readonly id = '@itookit/coreutils';
    readonly version = '1';

    constructor(private readonly options: CoreutilsPluginOptions) {}

    install(registration: HarnessRegistration): void {
        for (const program of this.options.programs ?? []) registration.registerProgram(program);
        for (const effect of this.options.effects) registration.registerEffect(effect);
    }

    onSessionClosed(sessionId: string): void | Promise<void> {
        return this.options.onSessionClosed?.(sessionId);
    }
}
