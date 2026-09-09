import { escapeHTML, t, type ICommandBus } from '@itookit/common';
import { FlowCommand, type FlowTaskTranscript } from '@itookit/llm-session';

export function openTaskTranscript(commands: ICommandBus, sessionId: string, taskId: string, targetTaskId: string): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'dag-dialog dag-transcript';
    dialog.innerHTML = `<form method="dialog"><h2>${escapeHTML(t('flow.transcript.title'))}</h2>
        <p data-status role="status">${escapeHTML(t('status.loading'))}</p>
        <pre data-transcript></pre><menu>
        <button type="button" data-more hidden>${escapeHTML(t('flow.transcript.more'))}</button>
        <button type="button" data-export disabled>${escapeHTML(t('flow.transcript.export'))}</button>
        <button type="button" data-export-text disabled>${escapeHTML(t('flow.transcript.exportText'))}</button>
        <button value="close">${escapeHTML(t('flow.transcript.close'))}</button></menu></form>`;
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    void loadTranscript(dialog, commands, { sessionId, taskId, targetTaskId });
}

async function loadTranscript(dialog: HTMLDialogElement, commands: ICommandBus,
    args: { sessionId: string; taskId: string; targetTaskId: string }, previous?: FlowTaskTranscript): Promise<void> {
    const more = dialog.querySelector<HTMLButtonElement>('[data-more]')!;
    more.disabled = true;
    try {
        const page = await commands.execute<FlowTaskTranscript>(FlowCommand.RunTranscript, previous
            ? { ...args, query: { version: previous.version, offset: previous.nextOffset } } : args);
        const transcript = previous ? { ...page, effects: [...previous.effects, ...page.effects] } : page;
        if (!dialog.isConnected) return;
        dialog.querySelector('[data-status]')!.textContent = `${transcript.nodeId ?? transcript.taskId} · ${transcript.status} · v${transcript.version}`;
        dialog.querySelector('[data-transcript]')!.textContent = transcriptText(transcript);
        const button = dialog.querySelector<HTMLButtonElement>('[data-export]')!;
        button.disabled = transcript.nextOffset !== undefined;
        button.onclick = () => downloadTranscript(transcript, 'json');
        const textButton = dialog.querySelector<HTMLButtonElement>('[data-export-text]')!;
        textButton.disabled = button.disabled;
        textButton.onclick = () => downloadTranscript(transcript, 'txt');
        more.hidden = transcript.nextOffset === undefined;
        more.onclick = () => void loadTranscript(dialog, commands, args, transcript);
    } catch (error) {
        if (dialog.isConnected) dialog.querySelector('[data-status]')!.textContent =
            error instanceof Error ? error.message : t('flow.transcript.failed');
    } finally { more.disabled = false; }
}

/** Show each recorded exchange separately; do not deduplicate away repeated or compacted context. */
export function transcriptText(transcript: FlowTaskTranscript): string {
    const sections = [
        `${t('flow.transcript.input')}\n${JSON.stringify(transcript.input, null, 2)}`,
        ...transcript.effects.map(effect => `${effect.request.kind} · ${effect.effectId} · ${effect.status}\n${JSON.stringify(effect, null, 2)}`),
        `${t('flow.transcript.interactions')}\n${JSON.stringify(transcript.interactions, null, 2)}`,
        `${t('flow.transcript.output')}\n${JSON.stringify(transcript.output ?? null, null, 2)}`,
    ];
    return sections.join('\n\n────────────────────\n\n');
}

function downloadTranscript(transcript: FlowTaskTranscript, format: 'json' | 'txt'): void {
    const content = format === 'json' ? JSON.stringify(transcript, null, 2) : exportTranscriptText(transcript);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript-${transcript.taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Include snapshot identity in standalone text exports as well as every recorded exchange. */
function exportTranscriptText(transcript: FlowTaskTranscript): string {
    const identity = { sessionId: transcript.sessionId, runTaskId: transcript.runTaskId,
        taskId: transcript.taskId, nodeId: transcript.nodeId, status: transcript.status,
        version: transcript.version, totalEffects: transcript.totalEffects ?? transcript.effects.length };
    return `${JSON.stringify(identity, null, 2)}\n\n${transcriptText(transcript)}\n`;
}
