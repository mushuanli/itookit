import { assertEffectGrant } from '@itookit/durable-kernel';
import type { IToolService, ToolInvokeResult } from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/durable-kernel';
import { forgetLoadedSkill } from '../skill/loaded-state';

type ToolSource = IToolService | ((context: EffectExecutionContext, request: ToolCallEffectRequest) => IToolService | Promise<IToolService>);

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

    constructor(
        private readonly service: ToolSource,
        private readonly onSkillLoaded?: (skillId: string, context: EffectExecutionContext) => void | ToolInvokeResult['skillContext'] | Promise<void | ToolInvokeResult['skillContext']>,
    ) {}

    async execute(request: ToolCallEffectRequest, context: EffectExecutionContext): Promise<ToolInvokeResult> {
        assertEffectGrant(context, request.resourceHandleId, 'tool');
        const service = await (typeof this.service === 'function' ? this.service(context, request) : this.service);
        const unloadKey = service.getToolMeta(request.toolId)?.skillUnloaderArgKey;
        if (unloadKey) {
            const id = request.args[unloadKey];
            if (typeof id !== 'string' || !id.trim()) throw new Error('skill_id argument is required');
            if (service.getToolMeta(request.toolId)?.enabled !== true) throw new Error('Skill unload tool is disabled');
            await forgetLoadedSkill(id, context.sessionState);
        }
        const result = requireToolSuccess(await service.invoke({ ...request, signal: context.abortSignal }));
        const key = service.getToolMeta(request.toolId)?.skillLoaderArgKey;
        const skillId = key ? request.args[key] : undefined;
        const skillContext = typeof skillId === 'string' && skillId
            ? await this.onSkillLoaded?.(skillId, context) : undefined;
        // Tool/provider output cannot manufacture persistent policy context.
        const { skillContext: _untrusted, ...output } = result;
        return skillContext ? { ...output, skillContext } : output;
    }

    async reconcile(
        request: ToolCallEffectRequest,
        context: EffectExecutionContext,
    ): Promise<EffectReconcileResult<ToolInvokeResult>> {
        const service = await (typeof this.service === 'function' ? this.service(context, request) : this.service);
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
