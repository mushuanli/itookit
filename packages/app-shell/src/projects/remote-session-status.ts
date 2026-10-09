import { harnessObservation } from '@itookit/piagent-driver';
import { conversationStatus } from '@itookit/ui-common';
import { resolveBrowserTarget, type ProjectService } from '@itookit/app-core';
import type { VFSNodeUI } from '@itookit/vfs-ui';

/** Host presentation over public tree ports; no access to the library's internal DOM. */
export class RemoteSessionStatusView {
    private readonly stops = new Map<string, () => void>();
    private readonly tabs = new Map<string, string>();
    private readonly fileVersions = new Map<string, string>();
    private current?: string;
    private visible = true;
    constructor(private readonly projects: ProjectService | undefined, private readonly changed: () => void,
        private readonly tabStatus: (id: string, icon: string, tooltip: string) => void,
        private readonly filesChanged?: (project: string) => void, private readonly tabTitle?: (id: string, title: string) => void) {}
    project(id?: string) { this.current = id; this.sync(); }
    attach(tab: string, project: string) { this.tabs.set(tab, project); this.sync(); }
    detach(tab: string) { this.tabs.delete(tab); this.sync(); }
    setVisible(visible: boolean) { this.visible = visible; this.sync(); }
    private sync() {
        const status = this.projects?.remoteMounts?.sessionStatus;
        if (!status) return;
        const ids = new Set(this.visible ? [this.current, ...this.tabs.values()].filter((id): id is string => !!id
            && !!this.projects?.remoteMounts?.list(id).some(m => m.at === '/' && m.serverProjectId)) : []);
        for (const [tab, project] of this.tabs) if (!ids.has(project)) this.tabStatus(tab, '', '');
        for (const [id, stop] of this.stops) if (!ids.has(id)) { stop(); this.stops.delete(id); }
        for (const id of ids) if (!this.stops.has(id)) this.stops.set(id, status.subscribe(id, () => {
            for (const [tab, project] of this.tabs) {
                let target;
                try { target = resolveBrowserTarget(tab); } catch { continue; }
                if (target.kind !== 'remote' || !target.profileId || !target.nativeSessionId) continue;
                const observation = status.get(project, target.profileId, target.nativeSessionId);
                const row = status.record(project, target.profileId, target.nativeSessionId);
                if (row?.title) this.tabTitle?.(tab, row.title);
                if (observation) { const view = conversationStatus(observation); this.tabStatus(tab, view.icon, view.tooltip); }
                else this.tabStatus(tab, '', '');
            }
            this.checkFiles(id);
            this.changed();
        }));
    }
    private checkFiles(project: string) {
        const version = this.projects?.remoteMounts?.sessionStatus?.fileVersion(project);
        if (version && this.fileVersions.get(project) !== version) { this.fileVersions.set(project, version); this.filesChanged?.(project); }
    }
    items(items: VFSNodeUI[]): VFSNodeUI[] {
        return items.map(item => {
            let target;
            try { target = resolveBrowserTarget(item.id); } catch { return item; }
            let presentation = item.presentation;
            if (target.kind === 'remote' && target.profileId && target.nativeSessionId) {
                const raw = item.metadata.custom;
                const observation = this.current && this.projects?.remoteMounts?.sessionStatus?.get(this.current, target.profileId, target.nativeSessionId);
                const view = conversationStatus(observation || harnessObservation({id: target.nativeSessionId, title: '', cwd: null,
                    status: typeof raw.remoteStatus === 'string' ? raw.remoteStatus : null, updatedAt: null, resumable: false,
                    statusDetails: raw.remoteStatusDetails as never, lastTurnResult: raw.remoteLastResult as never}, [],
                {source: 'list', observedAt: Number(raw.remoteObservedAt) || 0, stale: Date.now() - Number(raw.remoteObservedAt) > 30_000}));
                presentation = {...presentation, badges: [view.icon + ' ' + view.text], attention: view.tooltip};
            }
            const record = target.kind === 'remote' && target.profileId && target.nativeSessionId && this.current
                ? this.projects?.remoteMounts?.sessionStatus?.record(this.current, target.profileId, target.nativeSessionId) : undefined;
            return {...item, metadata: record?.title ? {...item.metadata, title: record.title} : item.metadata, presentation, children: item.children && this.items(item.children)};
        });
    }
    destroy() { for (const stop of this.stops.values()) stop(); this.stops.clear(); this.tabs.clear(); this.fileVersions.clear(); }
}
