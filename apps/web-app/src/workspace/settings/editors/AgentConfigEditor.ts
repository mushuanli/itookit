/**
 * @file apps/workspace/settings/editors/AgentConfigEditor.ts
 */
import { IEditor, EditorOptions, UnifiedSearchResult, Heading } from '@itookit/common';
import { Executable, AgentConfig } from '../types';
import { SettingsService } from '../services/SettingsService';

export class AgentConfigEditor implements IEditor {
    private container!: HTMLElement;
    private content: Executable | null = null;
    private _isDirty = false;
    private listeners = new Map<string, Set<any>>();

    constructor(
        container: HTMLElement, 
        options: EditorOptions,
        private service: SettingsService
    ) {
        this.init(container, options.initialContent);
    }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('agent-config-editor');
        this.container.style.overflowY = 'auto';
        this.container.style.height = '100%';
        this.container.style.padding = '20px';
        this.container.style.backgroundColor = 'var(--st-bg-primary)';
        
        this.setText(initialContent || '{}');
    }

    // --- Core IEditor Implementation ---

    getText(): string {
        if (!this.content) return '{}';
        this.syncModelFromUI();
        return JSON.stringify(this.content, null, 2);
    }

    setText(text: string) {
        try {
            this.content = JSON.parse(text);
            if (this.content && !this.content.type) this.content.type = 'agent';
            this.render();
        } catch (e) {
            this.container.innerHTML = `<div class="settings-error">Failed to parse agent config: ${(e as Error).message}</div>`;
        }
    }

    isDirty() { return this._isDirty; }
    setDirty(dirty: boolean) { this._isDirty = dirty; }

    // --- Rendering & Logic ---

    private render() {
        if (!this.content) return;
        const exec = this.content;
        
        this.container.innerHTML = `
            <form id="agent-form">
                <div class="settings-section">
                    <h3 class="settings-section__title">基本信息</h3>
                    <div class="settings-form__row">
                        <label class="settings-form__label">名称</label>
                        <input type="text" class="settings-form__input" name="name" value="${exec.name || ''}" placeholder="Agent Name">
                    </div>
                    <div class="settings-form__row">
                        <label class="settings-form__label">图标</label>
                        <input type="text" class="settings-form__input" name="icon" value="${exec.icon || ''}" placeholder="Emoji (e.g. 🤖)">
                    </div>
                    <div class="settings-form__row">
                        <label class="settings-form__label">描述</label>
                        <textarea class="settings-form__textarea" name="description" placeholder="Description...">${exec.description || ''}</textarea>
                    </div>
                    <div class="settings-form__row">
                        <label class="settings-form__label">类型</label>
                        <div style="display:flex; gap:20px;">
                            <label><input type="radio" name="type" value="agent" ${exec.type === 'agent' ? 'checked' : ''}> Agent</label>
                            <label><input type="radio" name="type" value="orchestrator" ${exec.type === 'orchestrator' ? 'checked' : ''}> Orchestrator</label>
                        </div>
                    </div>
                </div>

                <div id="agent-specific-config" style="display: ${exec.type === 'agent' ? 'block' : 'none'};">
                    ${this.renderAgentConfig(exec)}
                </div>
            </form>
        `;

        this.bindEvents();
    }

    private renderAgentConfig(exec: Executable) {
        const config = exec.config || {} as AgentConfig;
        const connections = this.service.getConnections();
        const models = connections.find(c => c.id === config.connectionId)?.availableModels || [];
        const allMCPServers = this.service.getMCPServers();
        const selectedMCPServers = config.mcpServers || [];

        return `
            <div class="settings-section">
                <h3 class="settings-section__title">LLM 配置</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label">连接</label>
                    <select class="settings-form__select" name="connectionId">
                        <option value="">-- 选择连接 --</option>
                        ${connections.map(c => `<option value="${c.id}" ${config.connectionId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">模型</label>
                    <select class="settings-form__select" name="modelName">
                         ${models.length ? models.map(m => `<option value="${m.id}" ${config.modelName === m.id ? 'selected' : ''}>${m.name}</option>`).join('') : '<option value="">默认</option>'}
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">System Prompt</label>
                    <textarea class="settings-form__textarea" name="systemPrompt" rows="6">${config.systemPrompt || ''}</textarea>
                </div>
            </div>
            
            <div class="settings-section">
                <h3 class="settings-section__title">工具配置 (MCP)</h3>
                <div class="settings-mcp-checklist">
                     ${allMCPServers.map(server => `
                        <label class="settings-mcp-item" style="display:flex; gap:10px; padding:5px; border:1px solid var(--st-border-color); margin-bottom:5px; border-radius:4px;">
                            <input type="checkbox" name="mcpServers" value="${server.id}" ${selectedMCPServers.includes(server.id) ? 'checked' : ''}>
                            <div>
                                <strong>${server.name}</strong><br>
                                <small style="color:var(--st-text-secondary)">${server.description || ''}</small>
                            </div>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    }

    private bindEvents() {
        // 全局输入监听 -> 触发 Dirty
        this.container.addEventListener('input', (_e) => {
            // 排除掉 type 切换导致的 display block，只关注值变化
            this._isDirty = true;
            this.emit('interactiveChange');
        });

        // 类型切换逻辑
        const typeRadios = this.container.querySelectorAll('input[name="type"]');
        typeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const val = (e.target as HTMLInputElement).value;
                const agentArea = this.container.querySelector('#agent-specific-config') as HTMLElement;
                if (agentArea) agentArea.style.display = val === 'agent' ? 'block' : 'none';
            });
        });

        // 简单的 Connection -> Model 联动
        const connSelect = this.container.querySelector('select[name="connectionId"]');
        const modelSelect = this.container.querySelector('select[name="modelName"]');
        if (connSelect && modelSelect) {
            connSelect.addEventListener('change', (e) => {
                const connId = (e.target as HTMLSelectElement).value;
                const conn = this.service.getConnections().find(c => c.id === connId);
                const models = conn?.availableModels || [];
                modelSelect.innerHTML = models.length 
                    ? models.map(m => `<option value="${m.id}">${m.name}</option>`).join('')
                    : '<option value="">默认</option>';
            });
        }
    }

    private syncModelFromUI() {
        if (!this.content) return;
        const form = this.container.querySelector('#agent-form') as HTMLFormElement;
        if (!form) return;

        // 使用简单的方式获取值，因为 FormData 对 checkbox 的处理需要特殊逻辑
        const getVal = (name: string) => (form.querySelector(`[name="${name}"]`) as HTMLInputElement)?.value;
        const getCheckedValues = (name: string) => 
            Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((el: any) => el.value);

        this.content.name = getVal('name');
        this.content.icon = getVal('icon');
        this.content.description = getVal('description');
        this.content.type = (form.querySelector('input[name="type"]:checked') as HTMLInputElement).value as any;

        if (this.content.type === 'agent') {
            this.content.config = {
                connectionId: getVal('connectionId'),
                modelName: getVal('modelName'),
                systemPrompt: getVal('systemPrompt'),
                mcpServers: getCheckedValues('mcpServers'),
                autoPrompts: this.content.config?.autoPrompts || []
            };
        }
    }

    // --- Stubs ---
    async destroy() { this.container.innerHTML = ''; this.listeners.clear(); }
    
    // 实现缺失的方法
    getMode(): 'edit' | 'render' { return 'edit'; }
    async switchToMode(_mode: 'edit' | 'render') { /* no-op for now */ }
    setTitle(_title: string) {}
    setReadOnly(_readOnly: boolean) {}
    get commands() { return {}; }
    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText() { return ''; }
    async getSummary() { return null; }
    async navigateTo(_target: { elementId: string }) {}
    async search(_query: string): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch(_result: UnifiedSearchResult) {}
    clearSearch() {}
    focus() {}

    // Event System
    on(event: string, cb: any) { 
        if(!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }
    emit(event: string, payload?: any) { this.listeners.get(event)?.forEach(cb => cb(payload)); }
}