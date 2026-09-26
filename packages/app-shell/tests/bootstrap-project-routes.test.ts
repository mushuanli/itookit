// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryMountService, SessionFilesService, ProjectService, type ApplicationRuntime } from '@itookit/app-core';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import type { WorkspaceConfig } from '../src/types';

vi.mock('../src/ThemeService', () => ({
    themeService: { init: vi.fn(async () => {}), destroy: vi.fn(), setMode: vi.fn(async () => {}) },
    ThemeMode: undefined,
}));

vi.mock('@itookit/mdxeditor', () => ({
    defaultEditorFactory: vi.fn(async () => ({ destroy: vi.fn(async () => {}) })),
}));

vi.mock('@itookit/kernel-adapters', () => ({
    createSessionSkillControls: vi.fn(() => ({})),
}));

vi.mock('@itookit/app-settings', () => ({
    createSettingsModule: vi.fn(async () => ({
        engine: {},
        service: { dispose: vi.fn() },
    })),
    createSettingsFactory: vi.fn(() => vi.fn(async () => ({ destroy: vi.fn(async () => {}) }))),
    SkillsEngine: class { async dispose() {} },
}));


import { initApp } from '../src/bootstrap';
import { parseWorkspaceHash } from '../src/navigation/workspace-route';

const workspace: WorkspaceConfig = { elementId: 'llm-workspace', workspaceName: 'chats', slug: 'chat', type: 'chat', title: 'Chat' };
const documentName = '新译林9A Unit 3 重点短语句子背诵版.prj';

async function fixture() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init();
    const files = new SessionFilesService(root); await files.initialize();
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    const mounts = new DirectoryMountService(root, files); await mounts.init();
    const projects = new ProjectService(root, repository, mounts, files); await projects.ensureStartup();
    await root.driver.createFile({ parentPath: '/home/admin/projects', name: documentName, content: 'original study notes' });
    const runtime = { vfs: manager, llmDriver: {}, agentService: { getConnections: async () => [] },
        sessionRepository: repository, sessionFiles: files, directoryMounts: mounts, projects,
        flowEngine: { engine: {} }, kernel: { kernel: { onChanged: () => () => {}, async *listSessions() {} }, sessions: {} },
        sessionManager: { onGlobalEvent: () => () => {} }, commandBus: {} } as unknown as ApplicationRuntime;
    const ui = { createChatEditor: () => defaultEditorFactory, createAgentEditor: () => defaultEditorFactory,
        createFlowEditor: () => defaultEditorFactory, createSkillEditor: () => defaultEditorFactory,
        createAIContextMenu: () => ({}), createFlowContextMenu: () => ({}), llmUiEditors: {} };
    return { root, projects, async start() {
        document.body.innerHTML = '<div id="llm-workspace" class="workspace-view"></div>';
        return initApp({ runtime, workspaces: [workspace], defaultSlug: 'chat', routeAliases: { projects: 'llm-workspace' }, ui: ui as any });
    }, async dispose() { await mounts.dispose(); await files.dispose(); await repository.dispose(); await manager.dispose(); } };
}

beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { document.body.replaceChildren(); history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('saved project routes at bootstrap', () => {
    it('opens the old Chinese .prj bookmark, then reloads the canonical route without copying its data', async () => {
        const f = await fixture();
        history.replaceState(null, '', '#/projects/' + encodeURIComponent('/' + documentName));
        let app;
        try {
            app = await f.start();
            expect(defaultEditorFactory).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ initialContent: 'original study notes' }));
            expect(parseWorkspaceHash(location.hash, 'chat').resource).toContain('/@files/' + documentName);
            expect(location.hash).toMatch(/^#\/chat\//);
            const route = location.hash;
            await app.destroy(); app = undefined;
            history.replaceState(null, '', route);
            app = await f.start();
            expect(location.hash).toBe(route);
            expect(defaultEditorFactory).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ initialContent: 'original study notes' }));
            expect((await f.projects.list()).filter(p => p.project.directory === '/home/admin/projects')).toHaveLength(1);
            expect(await f.root.driver.readContent('/home/admin/projects/' + documentName, { encoding: 'utf-8' })).toBe('original study notes');
        } finally { await app?.destroy(); await f.dispose(); }
    });
    it.each(['#/chat/%2Fbad.prj', '#/chat/missing-session', '#/chat/%ZZ'])('keeps the app usable for %s', async hash => {
        const f = await fixture(); history.replaceState(null, '', hash);
        let app;
        try {
            app = await f.start();
            expect(location.hash).toBe('#/chat');
            expect(document.body.textContent).toContain('此地址无效或内容已不存在');
            expect(document.querySelector('.vfs-columns__navigation [aria-label="新建项目"]')).not.toBeNull();
        } finally { await app?.destroy(); await f.dispose(); }
    });
    it('keeps nested paths and decodes the shell URI envelope only once', () => {
        const resource = '/folder:%E9%A1%B9%E7%9B%AE/@files/a?branch=b';
        expect(parseWorkspaceHash('#/chat/' + encodeURIComponent(resource), 'chat')).toEqual({ slug: 'chat', resource });
        expect(parseWorkspaceHash('#/chat/folder:Project/@files/notes.md', 'chat').resource).toBe('folder:Project/@files/notes.md');
    });
});
