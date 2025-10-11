/**
 * #mdx/editor/plugins/toolbar.plugin.js
 * @file Manages the creation and population of the editor toolbar.
 */
export class ToolbarPlugin {
    name = 'core:toolbar';

    install(context) {
        // This plugin primarily provides functionality used by the MDxEditor class.
        // It listens for a 'post-init' event that the editor should fire.
        context.on('editorPostInit', ({ editor, pluginManager }) => {
            if (!editor.showToolbar) return;

            const mainControlsEl = editor.container.querySelector('.mdx-toolbar-main-controls');
            // [核心修复] 修正类名选择器
            const modeSwitcherEl = editor.container.querySelector('.mdx-toolbar-mode-switcher'); 
            
            if (!mainControlsEl || !modeSwitcherEl) return;

            const commands = pluginManager.commands;
            pluginManager.toolbarButtons.forEach(btnConfig => {
                if (btnConfig.type === 'separator') {
                    const sep = document.createElement('div');
                    sep.className = 'mdx-toolbar-separator';
                    mainControlsEl.appendChild(sep);
                    return;
                }

                const btn = document.createElement('button');
                btn.className = 'mdx-toolbar-btn';
                if (btnConfig.title) btn.title = btnConfig.title;
                
                if (typeof btnConfig.icon === 'string') {
                    btn.innerHTML = btnConfig.icon;
                } else if (btnConfig.icon instanceof HTMLElement) {
                    btn.appendChild(btnConfig.icon.cloneNode(true));
                }

                btn.onclick = () => {
                    const commandFn = commands[btnConfig.command];
                    if (commandFn) commandFn(editor);
                    else console.warn(`[Toolbar] Command "${btnConfig.command}" not found.`);
                };

                const targetEl = btnConfig.location === 'mode-switcher' ? modeSwitcherEl : mainControlsEl;
                targetEl.appendChild(btn);
            });
        });
    }
}
