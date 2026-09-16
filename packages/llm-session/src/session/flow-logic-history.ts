import { t } from '@itookit/common';
import type { FlowLogicEvent, FlowInteraction } from '@itookit/common';
import type { EventEnvelope, TaskRecord } from '@itookit/durable-kernel';
import { flowActor } from './flow-identity';

/** Both live history and read-only recovery consume the same durable phase event. */
export function flowLogicInteraction(task: TaskRecord, event: EventEnvelope): FlowInteraction | undefined {
    if (event.type !== 'flow.logic.completed') return undefined;
    const data = event.payload as FlowLogicEvent;
    if (!data || !['aggregate', 'judge'].includes(data.phase)) return undefined;
    const result = data.result as { stopReason?: string };
    const reason = result?.stopReason;
    const heading = reason === 'condition_met' ? t('flow.history.conditionMet')
        : reason === 'max_rounds' ? t('flow.history.roundLimit') : reason === 'continue' ? t('flow.history.continue') : '';
    return { id: `flow-${task.id}-logic-${data.phase}-${data.round}`, taskId: task.id,
        name: `${data.name} · ${data.round}`, role: 'assistant', status: 'success',
        actor: { ...flowActor(task), nodeId: data.nodeId, nodeName: data.name, round: data.round },
        content: `${heading ? heading + '\n\n' : ''}\`\`\`json\n${JSON.stringify(data.result, null, 2)}\n\`\`\``,
        createdAt: event.occurredAt };
}
