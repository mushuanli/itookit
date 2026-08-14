// @file: llm-ui/shell/NavigationHelper.ts
// Navigation + floating panel logic — extracted from LLMWorkspaceEditor.
// Handles: viewport-aware session finding, scroll-to navigation, and the floating nav panel.

import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { INavigationPresenter, NavPanelData, NavigatorWorkspaceState } from '../domain/ports/INavigationPresenter';
import type { IEditorEventBus } from '../domain/events';
import type {
    DagPluginManifest,
    DagPluginPresentation,
    ICommandBus,
} from '@itookit/common';
import type { SessionGroup } from '@itookit/llm-session';
import type { IBranchStore } from '../domain/ports/IBranchStore';
import type { NavDataBuilder } from '../services/NavDataBuilder';
import type { DOMCache } from '../components/common/DOMCache';
import type { TimerManager } from '../components/common/TimerManager';
import { FloatingNavPanel } from '../components/FloatingNavPanel';
import { Toast } from '@itookit/ui-common';

export interface NavigationDeps {
    domCache: DOMCache;
    commands: ICommandBus;
    historyView: IHistoryPresenter;
    bus: IEditorEventBus;
    branchStore: IBranchStore;
    navDataBuilder: NavDataBuilder;
    timers: TimerManager;
    getWorkspaceState: () => NavigatorWorkspaceState;
    onToggleDag: () => void;
    onCreateNode: (descriptor: DagPluginManifest) => Promise<void>;
}

export class NavigationHelper {
    private floatingNav: INavigationPresenter | null = null;
    private navRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private deps: NavigationDeps) {}

    get isNavVisible(): boolean {
        return this.floatingNav?.isVisible ?? false;
    }

    // ── Viewport-aware session finding ──────────────────────────────────────

    findCurrentVisibleSession(): string | null {
        const historyEl = this.deps.domCache.byId('llm-ui-history');
        if (!historyEl) return null;

        const rect = historyEl.getBoundingClientRect();
        const viewLine = rect.top + rect.height * 0.4;
        const sessions = historyEl.querySelectorAll('.llm-ui-session');

        let closest: Element | null = null;
        let minDist = Infinity;

        for (const session of sessions) {
            const r = session.getBoundingClientRect();
            if (r.top <= viewLine && r.bottom >= viewLine) {
                return (session as HTMLElement).dataset.sessionId || null;
            }
            const dist = Math.abs(r.top + r.height / 2 - viewLine);
            if (dist < minDist) { minDist = dist; closest = session; }
        }

        return (closest as HTMLElement)?.dataset.sessionId || null;
    }

    updateActiveSessionHighlight(): void {
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        const historyEl = this.deps.domCache.byId('llm-ui-history');
        if (!historyEl) return;

        const prev = historyEl.querySelector('.llm-ui-session.is-active');
        if (prev && (prev as HTMLElement).dataset.sessionId === currentId) return;
        prev?.classList.remove('is-active');

        const el = historyEl.querySelector(`[data-session-id="${currentId}"]`);
        el?.classList.add('is-active');
    }

    navigateToUserChat(direction: 'prev' | 'next'): void {
        const currentId = this.findCurrentVisibleSession();
        if (!currentId) return;

        this.deps.commands.execute<SessionGroup[]>('session.get-sessions').then(sessions => {
            const idx = sessions.findIndex(s => s.id === currentId);
            const step = direction === 'prev' ? -1 : 1;

            for (let i = idx + step; i >= 0 && i < sessions.length; i += step) {
                if (sessions[i].role === 'user') {
                    this.deps.bus.emit('nav:scrollTo', { sessionId: sessions[i].id });
                    return;
                }
            }
        }).catch(() => {});
    }

    navigateUnfolded(direction: 'prev' | 'next'): void {
        const result = this.deps.historyView.getUnfoldedNavigationTarget(direction);

        if (result === '__end__') {
            this.deps.historyView.scrollToBottom(true);
        } else if (result === '__start__') {
            const historyEl = this.deps.domCache.byId('llm-ui-history');
            historyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (result) {
            this.deps.bus.emit('nav:scrollTo', { sessionId: result });
        } else {
            Toast.info(direction === 'prev'
                ? 'No previous unfolded chat'
                : 'Already at the last unfolded chat');
        }
    }

    // ── Floating nav panel ──────────────────────────────────────────────────

    pushNavData(): void {
        if (!this.floatingNav?.isVisible) return;

        if (this.navRefreshTimer !== null) {
            this.deps.timers.clearTimeout(this.navRefreshTimer);
        }

        this.navRefreshTimer = this.deps.timers.setTimeout(async () => {
            this.navRefreshTimer = null;
            if (!this.floatingNav?.isVisible) return;
            const data = await this.buildNavData();
            this.floatingNav.update(data);
        }, 50);
    }

    async pushNavDataImmediate(): Promise<void> {
        if (!this.floatingNav) return;

        if (this.navRefreshTimer !== null) {
            this.deps.timers.clearTimeout(this.navRefreshTimer);
            this.navRefreshTimer = null;
        }

        const data = await this.buildNavData();
        this.floatingNav.update(data);
    }

    private async buildNavData(): Promise<NavPanelData> {
        const sessions = await this.deps.commands.execute<SessionGroup[]>('session.get-sessions');
        return this.deps.navDataBuilder.build(
            sessions,
            this.deps.historyView.getCollapseStates(),
            this.deps.branchStore.current,
            this.findCurrentVisibleSession() ?? undefined
        );
    }

    async toggleNavigator(container: HTMLElement): Promise<void> {
        if (!this.floatingNav) {
            this.floatingNav = new FloatingNavPanel(
                container,
                this.deps.bus as any,
                {
                    onToggleDag: this.deps.onToggleDag,
                    onSetContext: async (roundIds, mode) => {
                        await this.deps.commands.execute('session.context.set', {
                            roundIds,
                            mode,
                            scope: 'subtree',
                        });
                    },
                    listDagPlugins: () =>
                        this.deps.commands.execute<DagPluginPresentation[]>(
                            'plugin.dag.presentations',
                        ),
                    onCreateNode: this.deps.onCreateNode,
                },
            );
        }

        this.syncWorkspaceControls();

        if (!this.floatingNav.isVisible) {
            await this.pushNavDataImmediate();
        }

        this.floatingNav.toggle();
    }

    syncWorkspaceControls(): void {
        this.floatingNav?.setWorkspaceState(this.deps.getWorkspaceState());
    }

    destroy(): void {
        this.floatingNav?.destroy();
        this.floatingNav = null;
        if (this.navRefreshTimer !== null) {
            this.deps.timers.clearTimeout(this.navRefreshTimer);
            this.navRefreshTimer = null;
        }
    }
}
