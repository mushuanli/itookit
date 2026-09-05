import { describe, expect, it, vi } from 'vitest';
import { MDxController } from '../mdx/MDxController';
import { SessionRenderer } from './SessionRenderer';
import { LLMWorkspaceEditor } from '../../shell/LLMWorkspaceEditor';
import { SessionService } from '../../services/SessionService';

describe('LLM rename synchronization', () => {
    it('updates existing embedded MDX editors and the renderer context', () => {
        const embeddedEditor = { updateNodeId: vi.fn() };
        const renderer = Object.create(SessionRenderer.prototype) as any;
        renderer.context = { nodeId: '/old.chat', ownerNodeId: '/old.chat' };
        renderer.editorMap = new Map([['message-1', embeddedEditor]]);

        renderer.updateNodeId('/new.chat');

        expect(renderer.context).toMatchObject({
            nodeId: '/new.chat',
            ownerNodeId: '/new.chat',
        });
        expect(embeddedEditor.updateNodeId).toHaveBeenCalledWith('/new.chat');
    });

    it('keeps an explicitly independent embedded MDX owner', () => {
        const controller = Object.create(MDxController.prototype) as any;
        controller.options = {
            nodeId: '/old.chat',
            ownerNodeId: '/parent.chat',
        };
        controller.editor = { updateNodeId: vi.fn() };

        controller.updateNodeId('/new.chat');

        expect(controller.options.ownerNodeId).toBe('/parent.chat');
        expect(controller.editor.updateNodeId).toHaveBeenCalledWith('/new.chat');
    });

    it('updates workspace owner, history, session command, and manifest', async () => {
        const updateManifest = vi.fn(async () => {});
        const workspace = Object.create(LLMWorkspaceEditor.prototype) as any;
        workspace.options = {
            nodeId: '/old.chat',
            ownerNodeId: '/old.chat',
            chatEngine: {
                getManifest: vi.fn(async () => ({ title: 'Old' })),
                updateManifest,
            },
        };
        workspace.currentTitle = 'New';
        workspace.stateManager = { updateNodeId: vi.fn() };
        workspace.historyView = { updateNodeId: vi.fn() };
        workspace.commandBus = { execute: vi.fn(async () => {}) };

        workspace.updateNodeId('/new.chat');

        expect(workspace.options.ownerNodeId).toBe('/new.chat');
        expect(workspace.stateManager.updateNodeId).toHaveBeenCalledWith('/new.chat');
        expect(workspace.historyView.updateNodeId).toHaveBeenCalledWith('/new.chat');
        await vi.waitFor(() => {
            expect(updateManifest).toHaveBeenCalledWith('/new.chat', { title: 'New' });
        });
    });

    it('repairs a stale manifest title when an externally renamed session loads', async () => {
        const updateManifest = vi.fn(async () => {});
        const service = Object.create(SessionService.prototype) as any;
        service.engine = {
            getManifest: vi.fn(async () => ({ title: 'Old' })),
            updateManifest,
        };

        const title = await service.getSessionTitle('/new.chat', 'New');

        expect(title).toBe('New');
        expect(updateManifest).toHaveBeenCalledWith('/new.chat', { title: 'New' });
    });
});
