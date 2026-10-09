import {expect, it, vi} from 'vitest';
import {remoteSessionPath, type ProjectService} from '@itookit/app-core';
import {RemoteSessionStatusView} from '../src/projects/remote-session-status';
it('shares visible observers, updates native titles and refreshes files only when the version changes', () => {
    let callback: (() => void) | undefined, version: string | undefined;
    const stop = vi.fn(), title = vi.fn(), files = vi.fn(), changed = vi.fn();
    const observation = {execution: 'idle', connection: 'online', stale: false, receiptUnknown: false, source: 'list', observedAt: Date.now()};
    const status = {subscribe: vi.fn((_id: string, listener: () => void) => {callback = listener; return stop;}), get: () => observation,
        record: () => ({title: 'Native title'}), fileVersion: () => version};
    const projects = {remoteMounts: {sessionStatus: status, list: () => [{at: '/', serverProjectId: 'native'}]}} as unknown as ProjectService;
    const view = new RemoteSessionStatusView(projects, changed, vi.fn(), files, title), tab = remoteSessionPath('/P', 'codex', 's');
    view.project('project'); view.attach(tab, 'project'); expect(status.subscribe).toHaveBeenCalledOnce();
    callback!(); expect(title).toHaveBeenCalledWith(tab, 'Native title'); expect(files).not.toHaveBeenCalled();
    version = 'codex:event:2'; callback!(); callback!(); expect(files).toHaveBeenCalledExactlyOnceWith('project');
    version = 'codex:event:3'; callback!(); expect(files).toHaveBeenCalledTimes(2);
    view.setVisible(false); expect(stop).toHaveBeenCalledOnce(); view.setVisible(true); expect(status.subscribe).toHaveBeenCalledTimes(2);
    callback!(); expect(files).toHaveBeenCalledTimes(2); view.destroy(); expect(stop).toHaveBeenCalledTimes(2);
});
