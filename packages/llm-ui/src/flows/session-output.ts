import { escapeHTML, t, type ICommandBus } from '@itookit/common';
import { FlowCommand } from '@itookit/llm-session';
import { DagWorkbench } from '../components/DagWorkbench';

interface Run { taskId: string; sessionId: string; name: string; status: string }

/** A read-only attachment: opening outputs must never resume a stopped scheduler. */
export function openSessionFlowOutputs(commands: ICommandBus, sessionId: string, signal: AbortSignal): void {
    if (signal.aborted) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'dag-dialog dag-output-dialog';
    dialog.innerHTML = `<header><h2>${escapeHTML(t('flow.output.title'))}</h2><select aria-label="${escapeHTML(t('flow.runs.title'))}"></select>
        <button data-refresh>${escapeHTML(t('flow.output.refresh'))}</button><button data-close>${escapeHTML(t('flow.transcript.close'))}</button></header>
        <p data-error role="status"></p><div class="dag-output-dialog__body"></div>`;
    const body = dialog.querySelector<HTMLElement>('.dag-output-dialog__body')!;
    const message = dialog.querySelector<HTMLElement>('[data-error]')!;
    const select = dialog.querySelector('select')!;
    const workbench = new DagWorkbench(body, { commands, backLabel: t('flow.transcript.close'),
        onModeChange: mode => { if (mode === 'design') dialog.close(); } });
    let revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => dialog.close();
    dialog.addEventListener('close', () => { revision++; clearTimeout(timer); workbench.destroy(); signal.removeEventListener('abort', close); dialog.remove(); }, { once: true });
    signal.addEventListener('abort', close, { once: true });
    dialog.querySelector('[data-close]')!.addEventListener('click', close);
    const open = async () => {
        if (!select.value || signal.aborted) return;
        try { await workbench.openRun(select.value, sessionId); }
        catch (error) { if (dialog.isConnected) message.textContent = String(error); }
    };
    const refresh = async () => {
        const current = ++revision; clearTimeout(timer);
        try {
            const runs = await commands.execute<Run[]>(FlowCommand.RunList, { sessionId });
            if (current !== revision || signal.aborted || !dialog.isConnected) return;
            const ownRuns = runs.filter(run => run.sessionId === sessionId), previous = select.value;
            select.innerHTML = ownRuns.map(run => `<option value="${escapeHTML(run.taskId)}">${escapeHTML(run.name)} · ${escapeHTML(run.status)}</option>`).join('');
            if (ownRuns.some(run => run.taskId === previous)) select.value = previous;
            message.textContent = ownRuns.length ? '' : t('flow.runs.empty');
            await open();
            if (!ownRuns.length) timer = setTimeout(() => { void refresh(); }, 1000);
        } catch (error) { if (current === revision && dialog.isConnected) message.textContent = String(error); }
    };
    select.addEventListener('change', () => { void open(); });
    dialog.querySelector('[data-refresh]')!.addEventListener('click', () => { void refresh(); });
    document.body.append(dialog); dialog.showModal(); void refresh();
}
