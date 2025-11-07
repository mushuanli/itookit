/**
 * @file mdxeditor/mdxplugins/core-titlebar.plugin.js
 * @description Contributes the default buttons to the title bar.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */
/** @typedef {import('../core/plugin-manager.js').PluginManager} PluginManager */

import * as commands from '../editor/commands.js';

export class CoreTitleBarPlugin {
    name = 'core:titlebar';

    constructor() {
        /**
         * @private
         * @type {HTMLButtonElement | null}
         */
        this.toggleModeBtn = null;
    }

    /**
     * @param {PluginContext} context
     */
    install(context) {
        context.listen('editorPostInit', ({ /** @type {MDxEditor} */ editor }) => {
            const titleBarOptions = editor.options.titleBar || {};

            // 1. Register Toggle Sidebar button
            if (typeof titleBarOptions.toggleSidebarCallback === 'function') {
                context.registerTitleBarButton({
                    id: 'toggle-sidebar',
                    title: 'Toggle Sidebar',
                    icon: '<i class="fas fa-bars"></i>',
                    location: 'left',
                    onClick: titleBarOptions.toggleSidebarCallback
                });
            }

            // 2. Register Toggle Edit Mode button
            if (titleBarOptions.enableToggleEditMode) {
                context.registerCommand('toggleEditMode', (editorInstance) => editorInstance.toggleMode());

                context.registerTitleBarButton({
                    id: 'toggle-edit-mode',
                    title: 'Switch to Read Mode',
                    icon: '<i class="fas fa-book-open"></i>',
                    location: 'left',
                    command: 'toggleEditMode'
                });
            }
            
            // 3. Register AI button (conditional)
            if (typeof titleBarOptions.aiCallback === 'function') {
                context.registerCommand('triggerAI', (editorInstance) => {
                    commands.handleAIAction(editorInstance.editorView, titleBarOptions.aiCallback);
                });

                context.registerTitleBarButton({
                    id: 'ai-action',
                    title: 'AI Processing',
                    icon: '<i class="fas fa-magic"></i>',
                    location: 'right',
                    command: 'triggerAI'
                });
            }
            
            // 4. Register Save button (conditional)
            if (typeof titleBarOptions.saveCallback === 'function') {
                context.registerCommand('triggerSave', (editorInstance) => {
                    commands.handleSaveAction(editorInstance.editorView, titleBarOptions.saveCallback);
                });

                context.registerTitleBarButton({
                    id: 'save-action',
                    title: 'Save',
                    icon: '<i class="fas fa-save"></i>',
                    location: 'right',
                    command: 'triggerSave'
                });
            }

            // 5. Register Print button
            const printHandler = titleBarOptions.printCallback 
                ? () => titleBarOptions.printCallback(editor) 
                : () => commands.handlePrintAction(editor);

            context.registerCommand('triggerPrint', printHandler);
            
            context.registerTitleBarButton({
                id: 'print-action',
                title: 'Print',
                icon: '<i class="fas fa-print"></i>',
                location: 'right',
                command: 'triggerPrint'
            });
        });

        // Phase 2: Render ALL registered buttons into the DOM.
        context.listen('editorPostInit', ({ /** @type {MDxEditor} */ editor, /** @type {PluginManager} */ pluginManager }) => {
            const titleBarEl = editor.container.querySelector('.mdx-title-bar');
            if (!titleBarEl) return;
            
            const leftControlsEl = titleBarEl.querySelector('.mdx-title-bar-controls.left');
            const rightControlsEl = titleBarEl.querySelector('.mdx-title-bar-controls.right');
            const registeredCommands = pluginManager.commands;

            if (!leftControlsEl || !rightControlsEl) return;

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

        context.listen('modeChanged', ({ mode }) => {
            if (!this.toggleModeBtn) return;

            if (mode === 'edit') {
                this.toggleModeBtn.innerHTML = '<i class="fas fa-book-open"></i>';
                this.toggleModeBtn.title = 'Switch to Read Mode';
            } else { // mode === 'render'
                this.toggleModeBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
                this.toggleModeBtn.title = 'Switch to Edit Mode';
            }
        });
    }

    destroy() {
        this.toggleModeBtn = null;
    }
}
