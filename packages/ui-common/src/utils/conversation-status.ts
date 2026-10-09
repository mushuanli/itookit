import { HARNESS_STATE_ICONS, t } from '@itookit/common';
import type { ConversationSnapshot } from '../interfaces/ConversationControls';

export function conversationStatus(observation: NonNullable<ConversationSnapshot['observation']>) {
    const key = observation.connection === 'offline' ? 'offline' : observation.stale ? 'stale' : observation.nativeError ? 'error' : observation.execution;
    const label = t(`harness.state.${key}`);
    const result = observation.lastResult ? t(`harness.result.${observation.lastResult}`) : '';
    const text = [label, result, observation.receiptUnknown ? t('harness.unknown') : ''].filter(Boolean).join(' · ');
    const tooltip = [text, t(observation.canInterrupt && observation.canRespond ? 'harness.control.both' : observation.canInterrupt ? 'harness.control.interrupt' : observation.canRespond ? 'harness.control.respond' : 'harness.control.observe'),
        t('harness.observed', {source: t(`harness.source.${observation.source}`),
        time: observation.observedAt ? new Date(observation.observedAt).toLocaleString() : t('harness.state.unknown')})].join('\n');
    return {text, tooltip, icon: HARNESS_STATE_ICONS[key],
        indicator: key === 'running' ? 'running' : key === 'waiting-approval' || key === 'waiting-input' ? 'waiting' : 'idle'};
}
