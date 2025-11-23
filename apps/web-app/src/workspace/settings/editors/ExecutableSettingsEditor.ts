// @file: app/workspace/settings/editors/ExecutableSettingsEditor.ts
import { BaseSettingsEditor } from './BaseSettingsEditor';
import { Executable, AgentConfig } from '../types';
import { generateShortUUID } from '@itookit/common';
import { Modal, Toast } from '../components/UIComponents';

export class ExecutableSettingsEditor extends BaseSettingsEditor {
    private selectedId: string | null = null;
    private draggedElement: HTMLElement | null = null;

    render() {
        const allExecutables = this.service.getExecutables();
        
        // 排序逻辑：Agent 在前，Orchestrator 在后
        const executables = allExecutables.sort((a, b) => {
            if (a.type === 'agent' && b.type === 'orchestrator') return -1;
            if (a.type === 'orchestrator' && b.type === 'agent') return 1;
            if (a.type === 'orchestrator') return a.name.localeCompare(b.name);
            return 0;
        });
            
        if (!this.selectedId && executables.length > 0) {
            this.selectedId = executables[0].id;
        }
        // 校验选中项是否存在
        const selectedExecutable = executables.find(e => e.id === this.selectedId);
        if (!selectedExecutable && executables.length > 0) {
            this.selectedId = executables[0].id;
        }

        this.container.innerHTML = `
            <div class="settings-split">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3>Executables</h3>
                        <div class="settings-page__actions">
                            <button id="btn-add-executable" class="settings-btn-round" title="添加"><i class="fas fa-plus"></i></button>
                            <button id="btn-import-executable" class="settings-btn-round" title="导入"><i class="fas fa-file-import"></i></button>
                            <button id="btn-export-all" class="settings-btn-round" title="导出"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>
                    <div class="settings-split__list">
                        ${executables.map(exec => this.renderListItem(exec)).join('')}
                    </div>
                </div>

                <div class="settings-split__content">
                    ${selectedExecutable ? this.renderConfigPanel(selectedExecutable) : '<div class="settings-empty"><h3>请选择一个 Executable</h3></div>'}
                </div>
            </div>
        `;
        
        this.bindEvents();
    }

    private renderListItem(executable: Executable) {
        const isSelected = executable.id === this.selectedId;
        const icon = executable.icon || (executable.type === 'orchestrator' ? '<i class="fas fa-project-diagram"></i>' : '<i class="fas fa-robot"></i>');
        const typeLabel = executable.type === 'orchestrator' ? 'Orchestrator' : 'Agent';

        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${executable.id}">
                <span class="settings-list-item__icon">${icon}</span>
                <div class="settings-list-item__info">
                    <p class="settings-list-item__title">${executable.name}</p>
                    <p class="settings-list-item__desc">${typeLabel}</p>
                </div>
            </div>
        `;
    }

    private renderConfigPanel(executable: Executable) {
        const previewIcon = executable.icon || '<i class="fas fa-cog"></i>';
        
        return `
            <div class="settings-config-header">
                <div class="settings-config-header__title-area">
                    <span class="settings-config-header__icon" id="config-icon-preview">${previewIcon}</span>
                    <div>
                        <h2 class="settings-config-header__title">${executable.name}</h2>
                        <p class="settings-config-header__subtitle">${executable.description || '配置此单元的行为'}</p>
                    </div>
                </div>
                <div class="settings-config-header__actions">
                    <button class="settings-btn settings-btn--primary settings-btn-save"><i class="fas fa-save"></i> 保存</button>
                    <button class="settings-btn settings-btn--danger settings-btn-delete"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">基础信息</h3>
                <div class="settings-form__row"><label class="settings-form__label">名称</label><input type="text" class="settings-form__input" name="name" value="${executable.name || ''}"></div>
                <div class="settings-form__row"><label class="settings-form__label">图标</label><input type="text" class="settings-form__input" name="icon" value="${executable.icon || ''}"></div>
                <div class="settings-form__row"><label class="settings-form__label">描述</label><textarea class="settings-form__textarea" name="description">${executable.description || ''}</textarea></div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">类型</h3>
                <div style="display:flex; gap:20px; margin-bottom:10px;">
                    <label><input type="radio" name="type" value="agent" ${executable.type === 'agent' ? 'checked' : ''}> Agent</label>
                    <label><input type="radio" name="type" value="orchestrator" ${executable.type === 'orchestrator' ? 'checked' : ''}> Orchestrator</label>
                </div>
            </div>

            <div id="agent-config-container" style="display: ${executable.type === 'agent' ? 'block' : 'none'};">
                ${this.renderAgentConfig(executable)}
            </div>
            <div id="orchestrator-config-container" style="display: ${executable.type === 'orchestrator' ? 'block' : 'none'};">
                ${this.renderOrchestratorConfig(executable)}
            </div>
        `;
    }

    private renderAgentConfig(executable: Executable) {
        const config = executable.config || {} as AgentConfig;
        const connections = this.service.getConnections();
        const allMCPServers = this.service.getMCPServers();
        const selectedMCPServers = config.mcpServers || [];
        
        // 简单的模型选择逻辑：只列出连接，模型由后续加载或简化
        const selectedConn = connections.find(c => c.id === config.connectionId);
        const models = selectedConn?.availableModels || [];

        return `
            <div class="settings-section">
                <h3 class="settings-section__title"><i class="fas fa-brain"></i> LLM 模型配置</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label">连接</label>
                    <select class="settings-form__select" name="connectionId">
                        ${connections.map(c => `<option value="${c.id}" ${config.connectionId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">模型名称</label>
                    <select class="settings-form__select" name="modelName">
                        ${models.length ? models.map(m => `<option value="${m.id}" ${config.modelName === m.id ? 'selected' : ''}>${m.name}</option>`).join('') : '<option value="">默认</option>'}
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">System Prompt</label>
                    <textarea class="settings-form__textarea" name="systemPrompt" rows="8">${config.systemPrompt || ''}</textarea>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title"><i class="fas fa-plug"></i> MCP 工具配置</h3>
                <div class="settings-mcp-checklist">
                    ${allMCPServers.map(server => `
                        <label class="settings-mcp-item">
                            <input type="checkbox" name="mcpServers" value="${server.id}" ${selectedMCPServers.includes(server.id) ? 'checked' : ''} style="margin-right:10px">
                            <div>
                                <strong>${server.name}</strong>
                                <br><small>${server.description || '无描述'}</small>
                            </div>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title"><i class="fas fa-magic"></i> 自动化流程 (Auto Prompts)</h3>
                <div class="settings-sortable-list" id="auto-prompts-list">
                    ${(config.autoPrompts || []).map((prompt, i) => this.renderAutoPromptItem(prompt, i)).join('')}
                </div>
                <button class="settings-btn settings-btn--secondary settings-btn--sm" id="btn-add-auto-prompt" style="margin-top:10px">
                    <i class="fas fa-plus"></i> 添加步骤
                </button>
            </div>
        `;
    }

    private renderAutoPromptItem(prompt: string, index: number) {
        return `
            <div class="settings-sortable-item auto-prompt-item" draggable="true" data-index="${index}">
                <span class="drag-handle"><i class="fas fa-bars"></i></span>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span style="font-size:0.8rem; font-weight:bold; color:var(--st-color-primary)">步骤 ${index + 1}</span>
                        <button class="settings-btn-icon-small settings-btn-delete-prompt"><i class="fas fa-trash"></i></button>
                    </div>
                    <textarea class="settings-form__textarea auto-prompt-input" placeholder="输入提示词...">${prompt}</textarea>
                </div>
            </div>
        `;
    }

    private renderOrchestratorConfig(executable: Executable) {
        // 简化实现：只显示占位
        return `<div class="settings-section"><p class="settings-form__help">编排器配置功能（子 Agent 选择）在此处实现。</p></div>`;
    }

    private bindEvents() {
        this.clearListeners();

        // List Selection
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const item = (e.target as HTMLElement).closest('.settings-list-item') as HTMLElement;
                if (item) {
                    this.selectedId = item.dataset.id!;
                    this.render();
                }
            });
        }

        // Buttons
        this.bindButton('#btn-add-executable', () => this.addNewExecutable());
        this.bindButton('.settings-btn-save', () => this.saveExecutable());
        this.bindButton('.settings-btn-delete', () => this.deleteExecutable());
        
        // Auto Prompts Logic
        this.bindButton('#btn-add-auto-prompt', () => {
            const container = document.getElementById('auto-prompts-list');
            if (container) {
                const div = document.createElement('div');
                div.innerHTML = this.renderAutoPromptItem('', container.children.length);
                container.appendChild(div.firstElementChild!);
            }
        });

        // Delete Prompt Delegate
        const configPanel = this.container.querySelector('.settings-split__content');
        if (configPanel) {
            this.addEventListener(configPanel, 'click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.settings-btn-delete-prompt')) {
                    const item = target.closest('.auto-prompt-item');
                    item?.remove();
                }
            });
        }

        // Drag and Drop (简化绑定)
        const sortableList = document.getElementById('auto-prompts-list');
        if (sortableList) {
            this.bindSortableList(sortableList);
        }
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    private bindSortableList(list: HTMLElement) {
        this.addEventListener(list, 'dragstart', (e: any) => {
            const target = e.target.closest('.settings-sortable-item');
            if (target) {
                this.draggedElement = target;
                target.classList.add('dragging');
            }
        });
        this.addEventListener(list, 'dragend', (e: any) => {
            const target = e.target.closest('.settings-sortable-item');
            if (target) target.classList.remove('dragging');
            this.draggedElement = null;
        });
        this.addEventListener(list, 'dragover', (e: any) => {
            e.preventDefault();
            if (!this.draggedElement) return;
            const afterElement = this.getDragAfterElement(list, e.clientY);
            if (afterElement == null) {
                list.appendChild(this.draggedElement);
            } else {
                list.insertBefore(this.draggedElement, afterElement);
            }
        });
    }

    private getDragAfterElement(container: HTMLElement, y: number) {
        const draggableElements = [...container.querySelectorAll('.settings-sortable-item:not(.dragging)')];
        return draggableElements.reduce((closest: any, child: any) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // CRUD Actions
    private async addNewExecutable() {
        const newExec: Executable = {
            id: `exec-${generateShortUUID()}`,
            name: 'New Agent',
            type: 'agent',
            config: { connectionId: '', modelName: '' }
        };
        await this.service.saveExecutable(newExec);
        this.selectedId = newExec.id;
    }

    private async saveExecutable() {
        if (!this.selectedId) return;
        const existing = this.service.getExecutables().find(e => e.id === this.selectedId);
        if (!existing) return;

        const getVal = (name: string) => (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement)?.value;
        
        // Collect auto prompts
        const prompts = Array.from(this.container.querySelectorAll('.auto-prompt-input')).map((el: any) => el.value);
        
        // Collect MCPs
        const mcps = Array.from(this.container.querySelectorAll('input[name="mcpServers"]:checked')).map((el: any) => el.value);

        const updated: Executable = {
            ...existing,
            name: getVal('name'),
            icon: getVal('icon'),
            description: getVal('description'),
            type: (this.container.querySelector('input[name="type"]:checked') as HTMLInputElement).value as any,
            config: {
                connectionId: getVal('connectionId'),
                modelName: getVal('modelName'),
                systemPrompt: getVal('systemPrompt'),
                autoPrompts: prompts,
                mcpServers: mcps
            }
        };

        await this.service.saveExecutable(updated);
        Toast.success('Saved');
    }

    private deleteExecutable() {
        if (!this.selectedId) return;
        Modal.confirm('Delete', 'Are you sure?', async () => {
            await this.service.deleteExecutable(this.selectedId!);
            this.selectedId = null;
            Toast.success('Deleted');
        });
    }
}
