// @file app/factories/settingsFactory.ts
import { EditorFactory, IEditor } from '@itookit/common';
import { SettingsService } from '../workspace/settings/services/SettingsService';

// 导入所有具体的 Editor 类
import { MCPSettingsEditor } from '../workspace/settings/editors/MCPSettingsEditor';
import { TagSettingsEditor } from '../workspace/settings/editors/TagSettingsEditor';
import { ConnectionSettingsEditor } from '../workspace/settings/editors/ConnectionSettingsEditor';
// import { ExecutableSettingsEditor } from '../workspace/settings/editors/ExecutableSettingsEditor'; // Removed
import { ContactSettingsEditor } from '../workspace/settings/editors/ContactSettingsEditor';
import { StorageSettingsEditor } from '../workspace/settings/editors/StorageSettingsEditor';
import { AboutSettingsEditor } from '../workspace/settings/editors/AboutSettingsEditor';

export const createSettingsFactory = (service: SettingsService): EditorFactory => {
    return async (container: HTMLElement, options: any): Promise<IEditor> => {
        const nodeId = options.nodeId;
        
        await service.init();

        let editor: IEditor | null = null;

        switch (nodeId) {
            case 'storage':     editor = new StorageSettingsEditor(container, service, options); break;
            case 'tags':        editor = new TagSettingsEditor(container, service, options); break;
            case 'contacts':    editor = new ContactSettingsEditor(container, service, options); break;
            case 'connections': editor = new ConnectionSettingsEditor(container, service, options); break;
            // case 'executables': editor = new ExecutableSettingsEditor(container, service, options); break; // Removed
            case 'mcp-servers': editor = new MCPSettingsEditor(container, service, options); break;
            case 'about':       editor = new AboutSettingsEditor(container, service, options); break;
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
