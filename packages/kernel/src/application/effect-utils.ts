// @file: kernel/src/application/effect-utils.ts
// Effect 执行的纯辅助：请求规范化、结果回填、超时/取消、失败序列化。

import type {
    EffectAdapter,
    EffectExecutionContext,
    EffectRequest,
    InteractionRequest,
    JsonValue,
    ResourceRight,
    SerializableError,
    TaskRecord,
} from '../domain/types';
import { createId, type EffectClaim, type EffectCompletion } from '../infrastructure/seqfile/store';
import { assertDurableValue } from './durability';
import { KernelErrorCode, kernelError } from '../domain/errors';

export type RequiredEffect = EffectRequest & { id: string; timeoutMs: number };

export function normalizeEffect(effect: EffectRequest): RequiredEffect {
    const normalized = { ...effect, id: effect.id ?? createId('effect'), timeoutMs: effect.timeoutMs ?? 30_000 };
    if (!normalized.kind || !normalized.version || !normalized.idempotencyKey) {
        throw new Error('Effect kind, version, and idempotencyKey are required');
    }
    if (!Number.isFinite(normalized.timeoutMs) || normalized.timeoutMs <= 0) {
        throw new Error('Effect timeoutMs must be a positive finite number');
    }
    assertDurableValue(normalized.request, 'Effect request');
    return normalized;
}

export function addEffect(task: TaskRecord, effect: RequiredEffect): TaskRecord {
    const persisted = { request: effect, status: 'pending' as const, attemptCount: 0, attempts: [] };
    return { ...task, effects: { ...task.effects, [effect.id]: persisted } };
}

export function addInteraction(
    task: TaskRecord,
    request: InteractionRequest<JsonValue>,
): TaskRecord {
    if (!request.id || !request.prompt) throw new Error('Interaction id and prompt are required');
    if (task.interactions?.[request.id]) return task;
    const interaction = { ...request, status: 'pending' as const, requestedAt: Date.now() };
    return { ...task, interactions: { ...(task.interactions ?? {}), [request.id]: interaction } };
}

export async function executeEffectAdapter(
    adapter: EffectAdapter,
    effect: RequiredEffect,
    claim: EffectClaim,
    context: EffectExecutionContext,
): Promise<EffectCompletion> {
    const wasRecovered = claim.effect.attempts.some(attempt => attempt.outcome === 'lost');
    if (wasRecovered && adapter.reconcile) {
        const reconciled = await adapter.reconcile(effect.request, context);
        if (reconciled.status === 'completed') return { result: reconciled.result };
        if (reconciled.status === 'indeterminate') {
            return { error: reconciled.error, indeterminate: true };
        }
    }
    return { result: await adapter.execute(effect.request, context) };
}

export async function executeEffectWithDeadline(
    adapter: EffectAdapter,
    effect: RequiredEffect,
    claim: EffectClaim,
    context: EffectExecutionContext,
    controller: AbortController,
): Promise<EffectCompletion> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
        context.abortSignal.addEventListener('abort', () => {
            reject(abortError(context.abortSignal.reason));
        }, { once: true });
        timer = setTimeout(() => {
            const error = kernelError(KernelErrorCode.EFFECT_TIMEOUT, `Effect timed out after ${effect.timeoutMs}ms`);
            error.name = 'EffectTimeoutError';
            controller.abort(error);
            void adapter.cancel?.(effect.request, context).catch(() => {});
        }, effect.timeoutMs);
    });
    try {
        return await Promise.race([executeEffectAdapter(adapter, effect, claim, context), interrupted]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function abortError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    const error = kernelError(KernelErrorCode.EFFECT_CANCELLED, 'Effect execution was cancelled');
    error.name = 'AbortError';
    return error;
}

export function effectFailure(error: unknown): EffectCompletion {
    return { error: serializeError(error) };
}

export function effectControllerKey(sessionId: string, taskId: string, effectId: string): string {
    return `${sessionId}/${taskId}/${effectId}`;
}

export function activeEffectIds(task: TaskRecord): Set<string> {
    return new Set(Object.entries(task.effects)
        .filter(([, effect]) => effect.status === 'pending' || effect.status === 'leased')
        .map(([id]) => id));
}

export function serializeError(error: unknown): SerializableError {
    return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
}

export function isMissingPath(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT';
}

/** 断言 Effect 上下文已授予某 handle 的某类 resource 的某 right。 */
export function assertEffectGrant(
    context: EffectExecutionContext,
    handleId: string,
    resourceKind: string,
    right: ResourceRight = 'execute',
): void {
    const grant = context.grants.find(item =>
        item.handleId === handleId
        && item.right === right
        && item.resource.kind === resourceKind);
    if (!grant) throw new Error(`${resourceKind.toUpperCase()} ${right} grant is required: ${handleId}`);
}

/** 统一判定交互审批结果：true / {approved:true} / 常见同意字符串。 */
export function interactionApproved(value: JsonValue): boolean {
    if (value === true) return true;
    if (typeof value === 'string') {
        return ['yes', 'approved', 'allow', 'true', 'y', 'ok'].includes(value.trim().toLowerCase());
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value) && value.approved === true;
}
