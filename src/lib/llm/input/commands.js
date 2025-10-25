/**
 * @file #llm/input/commands.js
 * @description Manages command registration and execution.
 */

export class CommandManager {
    constructor(ui) {
        this.ui = ui;
        this.commands = {};
        this._registerDefaultCommands();
    }

    // +++ register 方法现在接受一个完整的配置对象
    register({ name, description, handler, executeOnClick = false }) {
        if (!name.startsWith('/')) {
            console.error(`Command name must start with "/". Got: ${name}`);
            return;
        }
        this.commands[name] = { description, handler, executeOnClick };
    }

    execute(text) {
        const [cmdName, ...args] = text.split(' ');
        const value = args.join(' ');
        
        const command = this.commands[cmdName];
        
        if (command && typeof command.handler === 'function') {
            command.handler.call(this.ui, value); // Call handler with UI instance as `this`
            this.ui._emit('commandExecute', { command: cmdName, value });
            this.ui._updateUIState();
        } else {
            this.ui._handleSubmit(true); // Pass flag to bypass command check
        }
    }

    getSuggestions(query) {
        return Object.entries(this.commands)
            .filter(([cmdName]) => cmdName.toLowerCase().startsWith(`/${query}`))
            .map(([cmdName, { description }]) => ({ 
                value: cmdName, 
                label: cmdName, 
                description 
            }));
    }

    _registerDefaultCommands() {
        // --- [安全修复] ---
        // 为 templates 和 personas 提供空对象作为默认值，防止因配置缺失而崩溃。
        const { localization: loc, templates = {}, personas = {} } = this.ui.options;
        
        // --- 现有命令保持不变 ---
        this.register({
            name: '/system',
            description: loc.systemCmdDesc,
            handler(value) {
                if (!value) {
                    this.showError(loc.systemPromptMissing);
                    return;
                }
                this.state.systemPrompt = value;
                this._showToast(loc.systemPromptSet);
            }
        });
        
        this.register({
            name: '/agent',
            description: loc.agentCmdDesc,
            handler(value) {
                if (!value) return;
                // +++ Call the new method name +++
                this.setAgent(value);
                this._showToast(`${loc.agentChangedTo} ${value}`);
            }
        });

        this.register({
            name: '/clear',
            description: loc.clearCmdDesc,
            handler() { this.clear(); },
            executeOnClick: true
        });

        this.register({
            name: '/help',
            description: loc.helpCmdDesc,
            handler() {
                const allCommands = Object.entries(this.commandManager.commands).map(([name, { description }]) => ({
                    value: name,
                    label: name,
                    description: description || ''
                }));
                this.popupManager.isHelpPopup = true;
                this.popupManager.show(allCommands);
            },
            executeOnClick: true
        });

        // +++ 注册新命令 +++

        // /template [name]
        if (Object.keys(templates).length > 0) {
            this.register({
                name: '/template',
                description: loc.templateCmdDesc,
                handler(value) {
                    if (templates[value]) {
                        this.elements.textarea.value = templates[value];
                        this.elements.textarea.focus();
                        this._updateUIState();
                    } else {
                        this.showError(`${loc.templateMissing} "${value}"`);
                    }
                }
            });
        }

        // [新增] 注册 /new 命令
        this.register({
            name: '/new',
            description: loc.newCmdDesc, // 使用我们刚刚添加的描述
            handler(value) {
                // 这个命令的逻辑由上层工作区处理。
                // 我们在这里只发射一个事件，并附带命令后的文本。
                this._emit('newSessionRequested', { text: value });
                
                // 清空输入框，准备接收新会话的下一条输入
                this.elements.textarea.value = '';
                this._updateUIState();
            }
        });

        // /save [name]
        this.register({
            name: '/save',
            description: loc.saveCmdDesc,
            handler(value) {
                const content = this.elements.textarea.value;
                if (!value || !content) return;
                // 触发事件，让外部应用处理保存逻辑
                const saved = this._emit('templateSave', { name: value, content });
                if (saved !== false) { // 允许事件处理器返回 false 来取消
                    this._showToast(`${loc.templateSaved} "${value}"`);
                    this.clear();
                }
            }
        });

        // /persona [name]
        if (Object.keys(personas).length > 0) {
            this.register({
                name: '/persona',
                description: loc.personaCmdDesc,
                handler(value) {
                    if (personas[value]) {
                        this.state.systemPrompt = personas[value];
                        this._showToast(`${loc.personaApplied} "${value}"`);
                        this.elements.textarea.value = ''; // 清空以便输入新问题
                        this._updateUIState();
                    } else {
                        this.showError(`Persona not found: "${value}"`);
                    }
                }
            });
        }
        
        // /no_context
        this.register({
            name: '/no_context',
            description: loc.noContextCmdDesc,
            handler() {
                this.state.sendWithoutContext = true;
                this._showToast(loc.noContextEnabled);
                this.elements.textarea.value = '';
                this._updateUIState();
            }
        });
    }
}