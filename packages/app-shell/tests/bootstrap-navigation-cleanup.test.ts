// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_EVENTS } from '@itookit/common';
import type { ApplicationRuntime } from '@itookit/app-core';
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
    SkillsEngine: class {},
}));

vi.mock('../src/core/Workbench', () => ({
    Workbench: class {
        start = vi.fn(async () => {});
        destroy = vi.fn(async () => {});
        openFile = vi.fn(async () => {});
        createAndOpenFile = vi.fn(async () => 'new-id');
        getActiveFilePath = vi.fn(() => null);
        setNodeWaitingInput = vi.fn();
    },
}));

vi.mock('../src/core/SessionWorkbench', () => ({
    SessionWorkbench: class {
        start = vi.fn(async () => {});
        destroy = vi.fn(async () => {});
        openResource = vi.fn(async () => {});
        createResource = vi.fn(async () => 'new-id');
        getActiveResourceId = vi.fn(() => null);
        setWaitingInput = vi.fn();
    },
}));

import { initApp } from '../src/bootstrap';

const workspace: WorkspaceConfig = {
    elementId: 'settings-workspace',
    workspaceName: 'settings',
    slug: 'settings',
    type: 'settings',
    title: 'Settings',
    supportedFileTypes: [],
    syncEnabled: false,
};

function makeRuntime(): ApplicationRuntime {
    return {
        vfs: { openFileSystem: vi.fn(async () => ({})) },
        llmDriver: {},
        agentService: { getConnections: vi.fn(async () => []) },
        sessionRepository: {},
        flowEngine: { engine: {} },
        sessionFiles: {},
        directoryMounts: {},
        kernel: { kernel: {}, sessions: {} },
        sessionManager: { onGlobalEvent: vi.fn(() => () => {}) },
        commandBus: {},
        runCatalog: {},
        dispose: vi.fn(async () => {}),
    } as unknown as ApplicationRuntime;
}

afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
    vi.restoreAllMocks();
});

describe('app-shell navigation listener cleanup', () => {
    it('does not handle navigation events after destroy()', async () => {
        const container = document.createElement('div');
        container.id = workspace.elementId;
        document.body.appendChild(container);

        const pushState = vi.spyOn(window.history, 'pushState');
        const handle = await initApp({
            runtime: makeRuntime(),
            workspaces: [workspace],
            ui: {
                createChatEditor: vi.fn(() => vi.fn(async () => ({ destroy: vi.fn(async () => {}) }))),
                createAgentEditor: vi.fn(() => vi.fn(async () => ({ destroy: vi.fn(async () => {}) }))),
                createFlowEditor: vi.fn(() => vi.fn(async () => ({ destroy: vi.fn(async () => {}) }))),
                createSkillEditor: vi.fn(() => vi.fn(async () => ({ destroy: vi.fn(async () => {}) }))),
                createAIContextMenu: vi.fn(() => ({})),
                createFlowContextMenu: vi.fn(() => ({})),
                llmUiEditors: {},
            },
        });

        document.dispatchEvent(new CustomEvent(NAVIGATION_EVENTS.NAVIGATE, {
            detail: { target: workspace.slug, resourceId: 'first', action: 'open' },
        }));
        await vi.waitFor(() => expect(pushState).toHaveBeenCalledTimes(1));

        await handle.destroy();

        document.dispatchEvent(new CustomEvent(NAVIGATION_EVENTS.NAVIGATE, {
            detail: { target: workspace.slug, resourceId: 'second', action: 'open' },
        }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(pushState).toHaveBeenCalledTimes(1);
    });
});
