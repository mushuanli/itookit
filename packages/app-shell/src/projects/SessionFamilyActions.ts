import { showNameDialog } from '../files/project-dialog';
import { t } from '@itookit/common';
import { type ProjectSessions } from '@itookit/app-core';
import type { ConversationManifest } from '@itookit/llm-session';

interface Actions {
    open(id: string): Promise<void>; child(id: string): Promise<unknown>; remove(id: string): Promise<void>;
    changed(): Promise<void>; showFamily(): void; report(error: unknown): void;
}

/** Small, explicit organization actions; every member keeps an independent editor. */
export class SessionFamilyActions {
    private headerEvents?: AbortController;
    constructor(private readonly sessions: ProjectSessions,
        private readonly signal: AbortSignal, private readonly actions: Actions) { signal.addEventListener('abort', () => this.headerEvents?.abort(), { once: true }); }
    async header(manifest: ConversationManifest): Promise<HTMLElement> {
        const header = document.createElement('div'); header.className = 'session-family__toolbar';
        const { members: sessions } = await this.sessions.family(manifest.id);
        if (manifest.parentSessionId) {
            const parent = sessions.find(item => item.id === manifest.parentSessionId);
            if (parent) header.append(this.button(t('project.parentSession', { name: parent.title }), () => this.actions.open(parent.id)));
        }
        if (sessions.length > 1) header.append(this.button(t('project.family'), async () => {
            if (window.matchMedia?.('(max-width: 768px)').matches) await this.showFamily(manifest.id);
            else this.actions.showFamily();
        }));
        header.append(this.button(t('project.newChild'), () => this.actions.child(manifest.id)));
        const menu = document.createElement('details'); menu.className = 'session-family__menu';
        const summary = document.createElement('summary'); summary.textContent = t('chat.toolbar.more');
        const items = document.createElement('div'); items.className = 'session-family__menu-items';
        menu.append(summary, items);
        this.bindMenu(menu);
        const item = (label: string, run: () => Promise<unknown>) => items.append(this.button(label, async () => { menu.open = false; await run(); }));
        item(t('project.renameSession'), () => this.rename(manifest.id));
        item(t('project.moveUnder'), () => this.move(manifest.id));
        if (manifest.parentSessionId) item(t('project.promoteSession'), () => this.promote(manifest.id));
        item(t('project.deleteSessionOnly'), () => this.remove(manifest.id));
        header.append(menu);
        if (manifest.parentSessionId && !manifest.currentHead) {
            const hint = document.createElement('span'); hint.className = 'session-family__hint'; hint.textContent = t('project.independentSession'); header.append(hint);
        }
        return header;
    }
    private bindMenu(menu: HTMLDetailsElement): void {
        this.headerEvents?.abort(); this.headerEvents = new AbortController();
        const signal = this.headerEvents.signal;
        document.addEventListener('click', event => { if (!menu.contains(event.target as Node)) menu.open = false; }, { signal });
        menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary')?.focus(); } }, { signal });
    }
    private async rename(id: string): Promise<void> {
        const session = await this.sessions.get(id);
        await showNameDialog(t('project.renameSession'), t('project.sessionName'), this.signal, async title => {
            await this.sessions.rename(id, title); await this.actions.changed(); await this.actions.open(id);
        }, undefined, { initialName: session.title, confirmLabel: t('project.save') });
    }
    private button(label: string, run: () => Promise<unknown>): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.onclick = () => { button.disabled = true; void run().catch(this.actions.report).finally(() => { button.disabled = false; }); };
        return button;
    }
    async promote(id: string): Promise<void> {
        await this.sessions.reparent(id, null); await this.actions.changed(); await this.actions.open(id);
    }
    async move(id: string): Promise<void> {
        const candidates = await this.sessions.moveCandidates(id);
        await this.picker(t('project.moveUnder'), candidates, async parent => {
            await this.sessions.reparent(id, parent);
            await this.actions.changed(); await this.actions.open(id);
        });
    }
    async showFamily(id: string): Promise<void> {
        const { members } = await this.sessions.family(id);
        await this.picker(t('project.family'), members, selected => this.actions.open(selected), id);
    }
    async remove(id: string): Promise<void> {
        const session = await this.sessions.get(id);
        if (!window.confirm(t('project.deleteSessionConfirm', { name: session.title }))) return;
        await this.actions.remove(id);
    }
    private picker(title: string, sessions: ConversationManifest[], select: (id: string) => Promise<void>, active?: string): Promise<void> {
        if (this.signal.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const previous = document.activeElement as HTMLElement | null;
            const dialog = document.createElement('dialog'); dialog.className = 'project-dialog session-family__picker'; dialog.setAttribute('aria-label', title);
            const heading = document.createElement('h2'); heading.textContent = title;
            const search = document.createElement('input'); search.type = 'search'; search.placeholder = t('project.searchContents'); search.setAttribute('aria-label', search.placeholder);
            const list = document.createElement('div'); list.className = 'session-family__choices';
            const status = document.createElement('p'); status.setAttribute('role', 'alert');
            const close = () => { dialog.close(); dialog.remove(); this.signal.removeEventListener('abort', close); previous?.focus(); resolve(); };
            const render = () => this.renderChoices(list, sessions, search.value, active, async id => {
                try { await select(id); close(); } catch (error) { status.textContent = (error as Error).message; }
            });
            search.oninput = render;
            dialog.oncancel = event => { event.preventDefault(); close(); };
            dialog.append(heading, search, list, status, this.button(t('project.cancel'), async () => close()));
            this.signal.addEventListener('abort', close, { once: true }); document.body.append(dialog); render(); dialog.showModal();
            (list.querySelector<HTMLElement>('[aria-current="true"]') ?? search).focus();
        });
    }
    private renderChoices(list: HTMLElement, sessions: ConversationManifest[], query: string, active: string | undefined,
        select: (id: string) => Promise<void>): void {
        list.replaceChildren();
        const names = new Map(sessions.map(item => [item.id, item.title]));
        for (const session of sessions) {
            const parent = session.parentSessionId && names.get(session.parentSessionId);
            const label = parent ? `${session.title} · ${t('project.parentSession', { name: parent })}` : session.title;
            if (!label.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
            const button = this.button(label, () => select(session.id));
            button.setAttribute('aria-current', String(session.id === active)); list.append(button);
        }
        if (!list.childElementCount) list.textContent = t('project.noSessions');
    }
}
