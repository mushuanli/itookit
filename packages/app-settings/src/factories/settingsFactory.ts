// @file app-settings/factories/settingsFactory.ts
import { EditorFactory, IEditor } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';
import { MCPSettingsEditor,ConnectionSettingsEditor,VFSAgentService } from '@itookit/llm-ui'; // 服务来自 llm-ui

import { TagSettingsEditor } from '../editors/TagSettingsEditor';
// import { ExecutableSettingsEditor } from '../workspace/settings/editors/ExecutableSettingsEditor'; // Removed
import { ContactSettingsEditor } from '../editors/ContactSettingsEditor';
import { StorageSettingsEditor } from '../editors/StorageSettingsEditor';
import { AboutSettingsEditor } from '../editors/AboutSettingsEditor';

export const createSettingsFactory = (
    settingsService: SettingsService,
    agentService: VFSAgentService
): EditorFactory => {
    return async (container: HTMLElement, options: any) => {
        const nodeId = options.nodeId;
        
        // 确保服务已初始化
        await settingsService.init();
        await agentService.init();

        let editor: IEditor | null = null;

        switch (nodeId) {
            case 'storage':     editor = new StorageSettingsEditor(container, settingsService, options); break;
            case 'tags':        editor = new TagSettingsEditor(container, settingsService, options); break;
            case 'contacts':    editor = new ContactSettingsEditor(container, settingsService, options); break;
            case 'connections': editor = new ConnectionSettingsEditor(container, agentService, options); break;
            // case 'executables': editor = new ExecutableSettingsEditor(container, service, options); break; // Removed
            case 'mcp-servers': editor = new MCPSettingsEditor(container, agentService, options); break;
            case 'about':       editor = new AboutSettingsEditor(container, settingsService, options); break;
            default:
                container.innerHTML = `<div style="padding:2rem;text-align:center;color:#666">Select a setting category</div>`;
                // 返回一个 Dummy Editor 存根
                return {
                    init: async () => {},
                    destroy: async () => {},
                    getText: () => '',
                    setText: () => {},
                    focus: () => {},
                    getMode: () => 'render',
                    switchToMode: async () => {},
                    setTitle: () => {},
                    setReadOnly: () => {},
                    isDirty: () => false,
                    setDirty: () => {},
                    commands: {},
                    search: async () => [],
                    gotoMatch: () => {},
                    clearSearch: () => {},
                    on: () => () => {},
                    navigateTo: async () => {}
                } as unknown as IEditor;
        }

        // [修复] 在这里显式调用 init，此时子类的构造函数已完全执行完毕
        if (editor) {
            // @ts-ignore BaseSettingsEditor has init method
            await editor.init(container);
        }

        return editor!;
    };
};
