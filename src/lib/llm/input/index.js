/**
 * @file #llm/input/index.js
 * @description A standalone, dependency-free, and highly customizable UI component for rich LLM interactions.
 * @version 2.0.0
 */
import './styles.css';

import { defaultOptions } from './defaults.js';
import { deepMerge } from './utils.js';
// +++ MODIFIED: No longer importing CSS injection +++
import { initialRender, renderAttachments, updateTheme } from './renderer.js';
import { attachEventListeners } from './events.js';
import { CommandManager } from './commands.js';
import { PopupManager } from './popup.js';


export class LLMInputUI {
    /**
     * Creates an instance of the LLM Input UI.
     * @param {HTMLElement} element The container element to render the UI into.
     * @param {object} options Configuration options.
     */
    constructor(element, options) {
        if (!element || !options || typeof options.onSubmit !== 'function') {
            throw new Error('LLMInputUI requires a container element and an onSubmit callback.');
        }

        this.container = element;
        this.options = deepMerge(JSON.parse(JSON.stringify(defaultOptions)), options);

        this.state = {
            attachments: [],
            isLoading: false,
            // +++ RENAMED: model -> agent +++
            agent: this.options.initialAgent,
            toolChoice: null,
            systemPrompt: null,
            popupSelectedIndex: -1,
            // +++ 新增状态标志
            sendWithoutContext: false, 
        };

        this.elements = initialRender(this.container, this.options);
        
        // --- REMOVED: injectStructuralCSS(this.options.classNames); ---
        // The user is now responsible for including the styles.css file.
        updateTheme(this.options.theme);
        
        // Initialize managers
        this.commandManager = new CommandManager(this);
        this.popupManager = new PopupManager(this);
        
        attachEventListeners(this);

        if (this.options.initialText) {
            this.elements.textarea.value = this.options.initialText;
        }
        // +++ MODIFIED: Initial UI state update now happens once at the end +++
        this._updateUIState();
    }

    // --- Public API Methods ---

    startLoading() {
        this.state.isLoading = true;
        this._updateSendButton();
        this._emit('loadingStart');
    }

    stopLoading() {
        this.state.isLoading = false;
        this._updateSendButton();
        this.elements.textarea.focus();
        this._emit('loadingStop');
    }

    clear() {
        this.elements.textarea.value = '';
        this.state.attachments = [];
        this.state.toolChoice = null;
        this._renderAttachments();
        this._updateUIState();
        this.elements.textarea.style.height = 'auto';
        this._hideError();
        this._emit('clear');
    }

    /**
     * Dynamically updates the component's theme.
     * @param {object} newThemeOptions - An object with CSS variables to update.
     */
    setTheme(newThemeOptions) {
        // Merge with existing theme to allow partial updates
        this.options.theme = { ...this.options.theme, ...newThemeOptions };
        updateTheme(this.options.theme);
        this._emit('themeChange', this.options.theme);
    }

    // +++ RENAMED: Public API setModel -> setAgent +++
    setAgent(agentId) {
        if (this.state.agent === agentId) return;
        this.state.agent = agentId;
        this._updateUIState(); // Update all UI elements including status bar and selector button
        // +++ MODIFIED: Emit 'agentChanged' event +++
        this._emit('agentChanged', agentId);
    }

    showError(message) {
        if (!this.elements.errorDisplay) return;
        this.elements.errorDisplay.textContent = message;
        this.elements.errorDisplay.style.display = 'block';
    }

    registerCommand(commandConfig) {
        this.commandManager.register(commandConfig);
    }

    // --- Internal State & UI Updaters (The "Controller" part) ---

    async _handleSubmit(bypassCommandCheck = false) {
        if (this.state.isLoading) {
            this._emit('stopRequested');
            return;
        }
        
        const text = this.elements.textarea.value.trim();
        if (!text && this.state.attachments.length === 0) return;

        if (text.startsWith('/') && !bypassCommandCheck) {
            this.commandManager.execute(text);
            return;
        }
        
        this.startLoading();
        try {
            await this.options.onSubmit({
                text,
                attachments: this.state.attachments.map(a => a.file),
                // +++ RENAMED: model -> agent +++
                agent: this.state.agent,
                toolChoice: this.state.toolChoice,
                systemPrompt: this.state.systemPrompt,
                // +++ 将新标志位传递出去
                sendWithoutContext: this.state.sendWithoutContext,
            });
            // 成功提交后重置临时状态
            this.state.systemPrompt = null; 
            this.state.toolChoice = null;
            this.state.sendWithoutContext = false; // +++ 重置
            this._updateStatusBar();
        } catch (error) {
            this.showError(error.message);
            this._emit('error', error);
        } finally {
            this.stopLoading();
        }
    }

    _removeAttachment(id) {
        const attachment = this.state.attachments.find(a => a.id === id);
        if (attachment) {
            this.state.attachments = this.state.attachments.filter(a => a.id !== id);
            this._renderAttachments();
            this._updateUIState();
            this._emit('attachmentRemove', attachment);
        }
    }

    _updateUIState() {
        const hasContent = this.elements.textarea.value.trim().length > 0 || this.state.attachments.length > 0;
        this.elements.sendBtn.disabled = !hasContent;
        this._updateSendButton();
        this._updateStatusBar();
        this._updateAgentSelector(); // +++ NEW +++
    }
    
    _updateSendButton() {
        const { localization: loc } = this.options;
        if (this.state.isLoading) {
            this.elements.sendBtn.innerHTML = '■';
            this.elements.sendBtn.title = loc.stopTitle;
            this.elements.sendBtn.disabled = false;
        } else {
            this.elements.sendBtn.innerHTML = '➤';
            this.elements.sendBtn.title = loc.sendTitle;
            const hasContent = this.elements.textarea.value.trim().length > 0 || this.state.attachments.length > 0;
            this.elements.sendBtn.disabled = !hasContent;
        }
    }

    _updateStatusBar() {
        const { statusBar } = this.elements;
        let tagsHTML = '';
        let visible = false;

        // Display a tag for system prompt
        if (this.state.systemPrompt) {
            tagsHTML += `<span class="status-tag system-prompt-tag">System Prompt Active <button data-action="clear-system-prompt">×</button></span>`;
            visible = true;
        }

        if (this.state.toolChoice) {
            tagsHTML += `<span class="status-tag tool-choice-tag">Tool: @${this.state.toolChoice.function.name} <button data-action="clear-tool-choice">×</button></span>`;
            visible = true;
        }

        // Display a tag for no-context mode
        if (this.state.sendWithoutContext) {
            tagsHTML += `<span class="status-tag no-context-tag">No Context <button data-action="clear-no-context">×</button></span>`;
            visible = true;
        }

        statusBar.innerHTML = tagsHTML;
        statusBar.style.display = visible ? 'flex' : 'none';

        // Add event listeners for the clear buttons
        statusBar.querySelectorAll('button').forEach(btn => {
            btn.onclick = (e) => {
                const action = e.target.dataset.action;
                if (action === 'clear-system-prompt') this.state.systemPrompt = null;
                if (action === 'clear-tool-choice') this.state.toolChoice = null;
                if (action === 'clear-no-context') this.state.sendWithoutContext = false;
                this._updateUIState();
            };
        });
    }

    // +++ NEW: Update the agent selector button icon +++
    _updateAgentSelector() {
        if (!this.elements.agentSelectorBtn) return;
        const agentInfo = this.options.agents.find(a => a.id === this.state.agent);
        const iconHTML = `<span class="agent-selector-icon">${agentInfo?.icon || '🤖'}</span>`;
        const nameHTML = `<span class="agent-selector-name">${agentInfo?.name || 'Select Agent'}</span>`;
        this.elements.agentSelectorBtn.innerHTML = `${iconHTML}${nameHTML}`;
    }

    _showToast(message, duration = 2000) {
        const toast = this.elements.toast;
        if (!toast) return;
        toast.textContent = message;
        toast.style.display = 'block';
        toast.style.opacity = '1';

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { toast.style.display = 'none'; }, 300);
        }, duration);
    }
    
    _hideError() {
        if (!this.elements.errorDisplay) return;
        this.elements.errorDisplay.style.display = 'none';
        this.elements.errorDisplay.textContent = '';
    }

    _renderAttachments() {
        renderAttachments(this);
    }
    
    _emit(eventName, payload) {
        if (this.options.on && typeof this.options.on[eventName] === 'function') {
            try { return this.options.on[eventName](payload); } catch (e) { console.error(`Error in '${eventName}' event handler:`, e); }
        }
        return undefined;
    }
}