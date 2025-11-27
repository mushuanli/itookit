// @file: app/workspace/settings/editors/ExecutableSettingsEditor.ts
import { BaseSettingsEditor } from './BaseSettingsEditor';
import { VFSUIManager, connectEditorLifecycle } from '@itookit/vfs-ui';
import { SettingsAgentEngine } from '../engines/SettingsAgentEngine';
import { AgentConfigEditor } from './AgentConfigEditor';
import { SettingsService } from '../services/SettingsService';

export class ExecutableSettingsEditor extends BaseSettingsEditor {
    private vfsUI: VFSUIManager | null = null;
    private agentEngine: SettingsAgentEngine;
    private lifecycleCleanup: (() => void) | null = null;

    constructor(container: HTMLElement, service: SettingsService, options: any) {
        super(container, service, options);
        // 初始化专门的 Agent Engine
        this.agentEngine = new SettingsAgentEngine(this.service);
    }

    async render() {
        if (this.vfsUI) return;

        // 1. 设置布局
        this.container.innerHTML = `
            <div class="settings-split" style="height: 100%; display: flex; overflow: hidden;">
                <div id="agent-sidebar" style="width: 280px; border-right: 1px solid var(--st-border-color); display: flex; flex-direction: column; background: var(--st-bg-secondary);"></div>
                <div id="agent-editor-area" style="flex: 1; height: 100%; position: relative;">
                    <div class="settings-empty">
                        <div class="settings-empty__icon">🤖</div>
                        <h3>选择一个智能体</h3>
                    </div>
                </div>
            </div>
        `;

        const sidebarEl = this.container.querySelector('#agent-sidebar') as HTMLElement;
        const editorEl = this.container.querySelector('#agent-editor-area') as HTMLElement;

        // 2. 初始化 VFS Sidebar
        this.vfsUI = new VFSUIManager({
            sessionListContainer: sidebarEl,
            title: 'Agents',
            searchPlaceholder: 'Search agents...',
            // 默认文件模板
            newSessionContent: JSON.stringify({
                name: 'New Agent',
                type: 'agent',
                config: { connectionId: '', modelName: '' }
            }, null, 2),
            // 可以自定义上下文菜单，这里使用默认的文件管理菜单即可
            contextMenu: {
                items: (_item, defaults) => defaults // 默认包含重命名、删除、移动等
            }
        }, this.agentEngine);

        await this.vfsUI.start();

        // 3. 连接编辑器生命周期
        // 这将自动处理：选中文件 -> 创建 AgentConfigEditor -> 脏检查 -> 自动保存 -> 销毁
        this.lifecycleCleanup = connectEditorLifecycle(
            this.vfsUI,
            this.agentEngine,
            editorEl,
            // Editor Factory
            async (el, opts) => {
                return new AgentConfigEditor(el, opts, this.service);
            },
            {
                saveDebounceMs: 1000, // 1秒防抖保存
                onEditorCreated: (_editor) => {
                    // 可以在这里做一些额外的 UI 更新，例如更新面包屑
                }
            }
        );
    }

    async destroy() {
        this.lifecycleCleanup?.(); // 清理自动保存监听器
        this.vfsUI?.destroy();
        await super.destroy();
    }
}
