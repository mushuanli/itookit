/**
 * #mdx/editor/plugins/core-titlebar.plugin.js
 * @file [NEW] Contributes the default buttons to the title bar.
 */

// [新增] 导入我们新创建的命令
import * as commands from '../editor/commands.js';

export class CoreTitleBarPlugin {
    name = 'core:titlebar';

    constructor() {
        /**
         * @private
         * @type {HTMLButtonElement | null}
         * A cached reference to the mode toggle button for dynamic updates.
         */
        this.toggleModeBtn = null;
    }

    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        context.on('editorPostInit', ({ editor }) => {
            const titleBarOptions = editor.options.titleBar || {};

            // 1. 注册 Toggle Sidebar 按钮
            // This button's existence is controlled by the presence of a callback in the editor's options.
            if (typeof titleBarOptions.toggleSidebarCallback === 'function') {
                context.registerTitleBarButton({
                    id: 'toggle-sidebar',
                    title: '切换侧边栏',
                    icon: '<i class="fas fa-bars"></i>',
                    location: 'left',
                    onClick: titleBarOptions.toggleSidebarCallback // Directly use the callback from options
                });
            }

            // 2. 注册 Toggle Edit Mode 按钮
            // This button's existence is controlled by a boolean flag in the editor's options.
            if (titleBarOptions.enableToggleEditMode) {
                // The command itself is simple, so we can register it here.
                context.registerCommand('toggleEditMode', (editorInstance) => editorInstance.toggleMode());

                context.registerTitleBarButton({
                    id: 'toggle-edit-mode',
                    title: '切换到阅读模式', // Initial title
                    icon: '<i class="fas fa-book-open"></i>', // Initial icon for 'edit' mode
                    location: 'left',
                    command: 'toggleEditMode'
                });
            }

            // ======================================================
            // ================ [NEW] 新增的按钮注册 ================
            // ======================================================

            // 3. [NEW] 注册 AI 按钮 (条件性)
            if (typeof titleBarOptions.aiCallback === 'function') {
                // 注册一个命令，该命令会调用通用命令处理器并传入特定的回调
                context.registerCommand('triggerAI', (editorInstance) => {
                    commands.handleAIAction(editorInstance.editorView, titleBarOptions.aiCallback);
                });

                context.registerTitleBarButton({
                    id: 'ai-action',
                    title: 'AI 处理',
                    icon: '<i class="fas fa-magic"></i>', // 使用 Font Awesome 魔法棒图标
                    location: 'right', // 放置在右侧
                    command: 'triggerAI'
                });
            }
            
            // 4. [NEW] 注册 保存 按钮 (条件性)
            if (typeof titleBarOptions.saveCallback === 'function') {
                context.registerCommand('triggerSave', (editorInstance) => {
                    commands.handleSaveAction(editorInstance.editorView, titleBarOptions.saveCallback);
                });

                context.registerTitleBarButton({
                    id: 'save-action',
                    title: '保存',
                    icon: '<i class="fas fa-save"></i>', // 使用 Font Awesome 保存图标
                    location: 'right',
                    command: 'triggerSave'
                });
            }

            // 5. [NEW & CORRECTED] 注册 打印 按钮 (无条件)
            // 如果用户提供了自定义打印回调，则使用它，否则使用我们改进的打印命令。
            // 确保将 editor 实例传递给命令。
            const printHandler = titleBarOptions.printCallback 
                ? () => titleBarOptions.printCallback(editor) 
                : () => commands.handlePrintAction(editor);

            context.registerCommand('triggerPrint', printHandler);
            
            context.registerTitleBarButton({
                id: 'print-action',
                title: '打印',
                icon: '<i class="fas fa-print"></i>', // 使用 Font Awesome 打印图标
                location: 'right',
                command: 'triggerPrint'
            });

        });

        // Phase 2: Render ALL registered buttons into the DOM.
        // This also happens on 'editorPostInit', ensuring all plugins have registered their buttons first.
        context.on('editorPostInit', ({ editor, pluginManager }) => {
            const titleBarEl = editor.container.querySelector('.mdx-title-bar');
            if (!titleBarEl) return;
            
            const leftControlsEl = titleBarEl.querySelector('.mdx-title-bar-controls.left');
            const rightControlsEl = titleBarEl.querySelector('.mdx-title-bar-controls.right');
            const registeredCommands = pluginManager.commands;

            if (!leftControlsEl || !rightControlsEl) return;

            // 清空现有按钮，以防热重载等场景
            leftControlsEl.innerHTML = '';
            rightControlsEl.innerHTML = '';

            pluginManager.titleBarButtons.forEach(btnConfig => {
                const btn = document.createElement('button');
                btn.className = 'mdx-title-bar-btn';
                if (btnConfig.title) btn.title = btnConfig.title;
                btn.innerHTML = btnConfig.icon || '';

                btn.onclick = () => {
                    if (typeof btnConfig.onClick === 'function') {
                        btnConfig.onClick(editor);
                    } else if (btnConfig.command) {
                        const commandFn = registeredCommands[btnConfig.command];
                        if (commandFn) commandFn(editor);
                        else console.warn(`[TitleBar] Command "${btnConfig.command}" not found.`);
                    }
                };

                const targetEl = btnConfig.location === 'left' ? leftControlsEl : rightControlsEl;
                targetEl.appendChild(btn);

                // Cache the reference to the mode toggle button so `switchTo` can update it.
                if (btnConfig.id === 'toggle-edit-mode') {
                    this.toggleModeBtn = btn;
                }
            });

            // Finally, hide the bar if it's truly empty.
            const titleEl = titleBarEl.querySelector('.mdx-title-bar-title');
            if (!titleEl.textContent && pluginManager.titleBarButtons.length === 0) {
                titleBarEl.style.display = 'none';
            }
        });

        // [KEY CHANGE] Listen for the 'modeChanged' event emitted by the editor.
        context.listen('modeChanged', ({ mode }) => {
            if (!this.toggleModeBtn) return;

            if (mode === 'edit') {
                this.toggleModeBtn.innerHTML = '<i class="fas fa-book-open"></i>';
                this.toggleModeBtn.title = '切换到阅读模式';
            } else { // mode === 'render'
                this.toggleModeBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
                this.toggleModeBtn.title = '切换到编辑模式';
            }
        });
    }

    destroy() {
        // Cleanup the cached reference
        this.toggleModeBtn = null;
    }
}
