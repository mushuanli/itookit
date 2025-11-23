// @file app/factories/settingsFactory.ts
import { EditorFactory, IEditor } from '@itookit/common';
import { SettingsService } from '../workspace/settings/services/SettingsService';

// 导入所有具体的 Editor 类
import { MCPSettingsEditor } from '../workspace/settings/editors/MCPSettingsEditor';
import { TagSettingsEditor } from '../workspace/settings/editors/TagSettingsEditor';
import { ConnectionSettingsEditor } from '../workspace/settings/editors/ConnectionSettingsEditor';
import { ExecutableSettingsEditor } from '../workspace/settings/editors/ExecutableSettingsEditor';
import { ContactSettingsEditor } from '../workspace/settings/editors/ContactSettingsEditor';
import { StorageSettingsEditor } from '../workspace/settings/editors/StorageSettingsEditor';
import { AboutSettingsEditor } from '../workspace/settings/editors/AboutSettingsEditor';

export const createSettingsFactory = (service: SettingsService): EditorFactory => {
    return async (container: HTMLElement, options: any): Promise<IEditor> => {
        const nodeId = options.nodeId;
        
        // 确保服务已初始化（数据已从 VFS 加载）
        await service.init();

        switch (nodeId) {
            case 'mcp-servers': return new MCPSettingsEditor(container, service, options);
            case 'tags':        return new TagSettingsEditor(container, service, options);
            case 'connections': return new ConnectionSettingsEditor(container, service, options);
            case 'executables': return new ExecutableSettingsEditor(container, service, options);
            case 'contacts':    return new ContactSettingsEditor(container, service, options);
            case 'storage':     return new StorageSettingsEditor(container, service, options);
            case 'about':       return new AboutSettingsEditor(container, service, options);

            default:
                container.innerHTML = `<div style="padding:2rem;text-align:center;color:#666">Select a setting category</div>`;
                // 返回一个 Dummy Editor
                return {
                    init: async () => {},
                    destroy: async () => {},
                    // ... implement other methods as no-ops
                } as unknown as IEditor;
        }
    };
};
