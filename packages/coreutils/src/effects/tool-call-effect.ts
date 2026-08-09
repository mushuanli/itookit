import type { IToolService, ToolInvokeResult } from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/harness';
import {
    assertCapabilityGrant,
    resolveCapability,
    type CapabilitySource,
} from '../ports/capabilities';

export interface ToolCallEffectRequest {
    resourceHandleId: string;
    toolId: string;
    args: Record<string, unknown>;
    cwd?: string;
    timeoutMs?: number;
}

export class ToolCallEffectAdapter implements EffectAdapter<ToolCallEffectRequest, ToolInvokeResult> {
    readonly kind = 'tool.call';
    readonly version = '1';

    constructor(private readonly service: CapabilitySource<IToolService>) {}

    async execute(request: ToolCallEffectRequest, context: EffectExecutionContext): Promise<ToolInvokeResult> {
        assertCapabilityGrant(context, request.resourceHandleId, 'tool');
        const service = await resolveCapability(this.service, context);
        return requireToolSuccess(await service.invoke({ ...request, signal: context.abortSignal }));
    }

    async reconcile(
        request: ToolCallEffectRequest,
        context: EffectExecutionContext,
    ): Promise<EffectReconcileResult<ToolInvokeResult>> {
        const service = await resolveCapability(this.service, context);
        if (service.getToolMeta(request.toolId)?.sideEffect === 'none') return { status: 'retry' };
        return {
            status: 'indeterminate',
            error: { message: `Tool outcome cannot be reconciled: ${request.toolId}`, code: 'TOOL_INDETERMINATE' },
        };
    }
}

export function requireToolSuccess(result: ToolInvokeResult): ToolInvokeResult {
    if (result.success) return result;
    throw new Error(result.error ?? result.output ?? `Tool failed: ${result.toolId}`);
}
