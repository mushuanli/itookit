import { BaseSettingsEditor, type ConversationControls, type ConversationSnapshot, type EditorOptions, type EditorEvent, type EditorEventCallback, type EditorEventMap } from '@itookit/ui-common';
import { t } from '@itookit/common';
import { conversationRequests } from './remote-interactions';
import { ConversationWorkspaceView } from './ConversationWorkspaceView';
import { RemoteBranches } from './remote-branches';
import { remoteRounds } from './remote-rounds';

/** Native histories remain remote; this editor only owns a view and input draft. */
export class RemoteConversationEditor extends BaseSettingsEditor<ConversationControls> {
    private view!: ConversationWorkspaceView;
    private branches?: RemoteBranches;
    private snapshot?: ConversationSnapshot;
    private closed = false;
    private working = false;
    private timer?: ReturnType<typeof setTimeout>;
    private historyTimer?: ReturnType<typeof setTimeout>;
    private loadingHistory = false;
    private historyError = '';
    private tail: Promise<unknown> = Promise.resolve();
    private announced?: string;
    private savedDraft = '';
    private restoredDraft = false;
    private readonly events = new Map<EditorEvent, Set<(payload: unknown) => void>>();
    private interactionKey = '';
    constructor(container: HTMLElement, controls: ConversationControls, options: EditorOptions) { super(container, controls, options); }
    async init(container: HTMLElement) {
        this.container = container;
        const abort = () => { void this.service.close().catch(() => {}); };
        this.options.signal?.throwIfAborted();
        this.options.signal?.addEventListener('abort', abort, {once: true});
        try { await this.render(); this.options.signal?.throwIfAborted(); }
        finally { this.options.signal?.removeEventListener('abort', abort); }
    }
    async render() {
        this.layout();
        try { await this.show(await this.service.read()); } catch (error) { this.showError(error); }
        if (!this.closed) this.schedule();
    }
    private layout() {
        this.view = new ConversationWorkspaceView(this.container, this.options, {
            send: text => this.sendText(text),
            stop: () => { void this.run(() => this.service.interrupt()).catch(() => {}); },
            refresh: () => { void this.run(() => this.service.read()).catch(() => {}); },
            reconcile: () => { void this.run(() => this.service.reconcile()).catch(() => {}); },
            earlier: () => { this.historyError = ''; void this.loadHistory(); },
            changed: () => this.emit('interactiveChange', undefined), copy: () => this.getText(),
        });
        this.branches = new RemoteBranches(this.service, this.options, action => this.run(action), error => this.showError(error));
        this.container.querySelector('#llm-branch-indicator')!.append(this.branches.element);
    }
    private async show(snapshot: ConversationSnapshot) {
        if (this.closed) return;
        this.snapshot = snapshot;
        this.restoreDraft(snapshot);
        await this.view.history.show(snapshot.messages);
        if (this.closed) return;
        if (snapshot.sessionId && !snapshot.pending && snapshot.sessionId !== this.announced) {
            this.announced = snapshot.sessionId; this.options.onConversationSession?.(snapshot.sessionId);
        }
        const key = JSON.stringify(snapshot.requests);
        if (key !== this.interactionKey) {
            this.interactionKey = key;
            this.view.interactions.replaceChildren(...conversationRequests(snapshot.requests, (id, response) => this.run(() => this.service.respond(id, response))));
        }
        this.view.setTitle(snapshot.title);
        this.view.setSessionTimes(snapshot.createdAt, snapshot.updatedAt);
        this.view.setStatus(snapshot.pending ? t('harness.unknown') : snapshot.disconnected ? t('harness.disconnected') : snapshot.gap ? t('harness.eventGap') : snapshot.active || snapshot.canInterrupt ? t('harness.running') : '',
            snapshot.pending ? 'queued' : snapshot.disconnected || snapshot.gap ? 'failed' : snapshot.active || snapshot.canInterrupt ? 'running' : 'idle');
        this.updateControls();
        this.queueHistory();
    }
    private restoreDraft(snapshot: ConversationSnapshot) {
        if (this.restoredDraft) return;
        this.savedDraft = snapshot.draft ?? '';
        if (!this.options.initialInputState?.text) this.view.input.setConfig({text: this.savedDraft});
        this.restoredDraft = true;
    }
    private updateControls() {
        if (this.snapshot) this.branches?.update(this.snapshot, this.working);
        this.view.earlier.hidden = !this.snapshot?.hasEarlier || !this.service.loadEarlier;
        this.view.earlier.disabled = this.working || this.loadingHistory;
        this.view.setHistoryProgress(this.snapshot?.messages.length ?? 0, !!this.snapshot?.hasEarlier, this.loadingHistory, this.historyError);
        this.view.input.setLoading(!!this.snapshot?.canInterrupt);
        this.view.input.setAvailability({
            canSend: !this.working && !this.options.readOnly && !!this.snapshot?.canSend,
            canInterrupt: !this.working && !this.options.readOnly && !!this.snapshot?.canInterrupt,
        });
        this.view.reconcile.disabled = this.working || !this.snapshot?.pending;
        for (const button of this.view.interactions.querySelectorAll('button')) button.disabled = this.working || !!this.options.readOnly || !this.snapshot?.canRespond;
    }
    private queueHistory(): void {
        if (this.closed || this.working || this.loadingHistory || this.historyTimer || this.historyError || !this.snapshot?.hasEarlier || !this.service.loadEarlier) return;
        this.historyTimer = setTimeout(() => { this.historyTimer = undefined; void this.loadHistory(); }, 0);
    }
    private async loadHistory(): Promise<void> {
        if (this.closed || this.working || this.loadingHistory || !this.snapshot?.hasEarlier || !this.service.loadEarlier) return;
        this.loadingHistory = true; this.updateControls();
        const operation = this.tail.then(async () => {
            try { if (!this.closed && !this.working) await this.show(await this.service.loadEarlier!()); }
            catch (error) { if (!this.closed) this.historyError = error instanceof Error ? error.message : String(error); }
            finally { this.loadingHistory = false; if (!this.closed) { this.updateControls(); this.queueHistory(); } }
        });
        this.tail = operation.catch(() => {}); await this.tail;
    }
    async sendText(text: string): Promise<void> {
        if (!text.trim()) return;
        if (this.closed || this.working || this.options.readOnly || !this.snapshot?.canSend) throw new Error(t('harness.remoteBusy'));
        await this.run(async () => {
            const result = await this.service.send(text);
            if (!this.closed) {
                if (this.view.input.getConfig().text.trim() === text.trim()) this.view.input.setConfig({text: ''});
                this.savedDraft = ''; this.emit(this.isDirty() ? 'interactiveChange' : 'saved', undefined);
            }
            return result;
        });
    }
    private async run(action: () => Promise<ConversationSnapshot>) {
        if (this.closed || this.working) return;
        this.working = true; this.updateControls();
        const operation = this.tail.then(async () => {
            try { await this.show(await action()); } catch (error) {
                await this.observeFailure(error);
                try { await this.show(await this.service.read()); } catch { /* Keep the last snapshot and draft. */ }
                if (!this.closed) this.showError(error);
                throw error;
            } finally { this.working = false; if (!this.closed) { this.updateControls(); this.queueHistory(); } }
        });
        this.tail = operation.catch(() => {});
        await operation;
    }
    private async observeFailure(error: unknown): Promise<void> {
        const snapshot = this.service.snapshot?.();
        if (snapshot) { await this.show(snapshot); return; }
        if (this.snapshot && error && typeof error === 'object' && 'outcome' in error && error.outcome === 'unknown') {
            this.snapshot = {...this.snapshot, pending: true, canSend: false, canInterrupt: false, canRespond: false, canFork: false};
        }
    }
    private showError(error: unknown) {
        this.view.setStatus(this.snapshot?.pending ? t('harness.unknown') : `${t('harness.failed')} ${error instanceof Error ? error.message : ''}`, this.snapshot?.pending ? 'queued' : 'failed');
    }
    private schedule() {
        this.timer = setTimeout(() => {
            if (this.closed) return;
            if (!this.working) {
                const poll = this.tail.then(async () => { if (!this.closed) await this.show(await this.service.poll()); });
                this.tail = poll.catch(() => { if (!this.closed) this.view.setStatus(t('harness.disconnected')); });
            }
            void this.tail.finally(() => { if (!this.closed) this.schedule(); });
        }, 1000);
    }
    async destroy() { if (this.closed) return; await this.flushPendingSave(); this.closed = true; clearTimeout(this.timer); clearTimeout(this.historyTimer); await this.service.close(); await this.tail; this.branches?.destroy(); this.view?.destroy(); this.container.replaceChildren(); }
    getText() { return remoteRounds(this.snapshot?.messages ?? []).map(group => group.content ?? group.executionRoot?.data.output ?? '').join('\n\n'); }
    focus() { this.view.input.focus(); }
    isDirty() { return (this.view?.input.getConfig().text ?? '') !== this.savedDraft; }
    async flushPendingSave() {
        if (!this.isDirty() || this.closed) return;
        try { await this.service.saveDraft?.(this.view?.input.getConfig().text ?? ''); this.savedDraft = this.view?.input.getConfig().text ?? ''; this.emit('saved', undefined); }
        catch (error) { this.emit('saveError', error); throw error; }
    }
    private emit<E extends EditorEvent>(event: E, payload: EditorEventMap[E]) { for (const listener of this.events.get(event) ?? []) listener(payload); }
    on<E extends EditorEvent>(event: E, callback: EditorEventCallback<E>): () => void {
        const listener = (payload: unknown) => callback(payload as EditorEventMap[E]);
        if (!this.events.has(event)) this.events.set(event, new Set());
        this.events.get(event)!.add(listener); return () => { this.events.get(event)?.delete(listener); };
    }
    setReadOnly(value: boolean) { this.options.readOnly = value; this.updateControls(); }
    get commands() { return {sendMessage: (message: {text: string; files?: File[]}) => {
        if (message.files?.length) return Promise.reject(new Error(t('harness.remoteAttachments')));
        return this.sendText(message.text);
    }}; }
}
