import { assertEffectGrant } from '@itookit/harness';
import type { IToolService, ToolInvokeResult } from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/harness';
import { resolveCapability, type CapabilitySource } from '../ports/capabilities';
import { requireToolSuccess } from './tool-call-effect';

export interface BashEffectRequest {
    resourceHandleId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
}

export class BashEffectAdapter implements EffectAdapter<BashEffectRequest, ToolInvokeResult> {
    readonly kind = 'process.exec';
    readonly version = '1';

    constructor(private readonly service: CapabilitySource<IToolService>) {}

    async execute(request: BashEffectRequest, context: EffectExecutionContext): Promise<ToolInvokeResult> {
        assertEffectGrant(context, request.resourceHandleId, 'process');
        if (!request.command.trim()) throw new Error('Process command is required');
        const service = await resolveCapability(this.service, context);
        return requireToolSuccess(await service.invoke({
            toolId: 'Bash',
            args: { command: request.command, timeout_ms: request.timeoutMs },
            cwd: request.cwd,
            timeoutMs: request.timeoutMs,
            signal: context.abortSignal,
        }));
    }

    async reconcile(): Promise<EffectReconcileResult<ToolInvokeResult>> {
        return {
            status: 'indeterminate',
            error: { message: 'Bash process outcome cannot be reconciled after worker loss', code: 'PROCESS_INDETERMINATE' },
        };
    }
}
