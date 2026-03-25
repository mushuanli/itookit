// @file llm-ui/editors/SkillSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID } from '@itookit/common';
import type { LLMSkill, LLMSkillType, IAgentManagementService } from '@itookit/common';

const SKILL_ICONS: Record<LLMSkillType, string> = {
    builtin: '⚙️',
    http:    '🌐',
    custom:  '🔧',
};

export class SkillSettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    private selectedId: string | null = null;

    async render() {
        const skills = await this.service.getSkills();

        // 修正选中状态
        if (this.selectedId && !skills.find(s => s.id === this.selectedId)) {
            this.selectedId = null;
        }
        if (!this.selectedId && skills.length > 0) {
            this.selectedId = skills[0].id;
        }

        const selected = skills.find(s => s.id === this.selectedId);

        this.container.innerHTML = `
            <div class="settings-split">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3><i class="fas fa-bolt"></i> Skills</h3>
                        <div class="settings-page__actions">
                            <button id="btn-add-skill" class="settings-btn-round" title="添加"><i class="fas fa-plus"></i></button>
                            <button id="btn-import-skill" class="settings-btn-round" title="导入"><i class="fas fa-file-import"></i></button>
                            <button id="btn-export-skills" class="settings-btn-round" title="导出"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>
                    <div class="settings-split__list">
                        ${skills.length === 0 ? this.renderEmptyList() : skills.map(s => this.renderListItem(s)).join('')}
                    </div>
                </div>
                <div class="settings-split__content">
                    ${selected ? this.renderConfigPanel(selected) : this.renderEmptyState()}
                </div>
            </div>
        `;

        this.bindEvents();
    }

    private renderEmptyList() {
        return `
            <div class="settings-empty settings-empty--mini">
                <p>暂无 Skill</p>
                <button class="settings-btn settings-btn--primary settings-btn--sm" id="btn-create-first">创建第一个</button>
            </div>
        `;
    }

    private renderListItem(skill: LLMSkill) {
        const isSelected = skill.id === this.selectedId;
        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${skill.id}">
                <span class="settings-list-item__icon">${skill.icon || SKILL_ICONS[skill.type] || '⚙️'}</span>
                <div class="settings-list-item__info">
                    <p class="settings-list-item__title">${skill.name}</p>
                    <p class="settings-list-item__desc">${skill.type}</p>
                </div>
                <span class="settings-badge ${skill.enabled ? 'settings-badge--success' : ''}">
                    ${skill.enabled ? '启用' : '禁用'}
                </span>
            </div>
        `;
    }

    private renderConfigPanel(skill: LLMSkill) {
        const isHTTP = skill.type === 'http';
        const paramsJson = skill.parameters ? JSON.stringify(skill.parameters, null, 2) : '';

        return `
            <div class="settings-config-header">
                <div class="settings-config-header__title-area">
                    <span class="settings-config-header__icon">${skill.icon || SKILL_ICONS[skill.type] || '⚙️'}</span>
                    <div>
                        <h2 class="settings-config-header__title">${skill.name}</h2>
                        <p class="settings-config-header__subtitle">${skill.description || '配置此 Skill'}</p>
                    </div>
                </div>
                <div class="settings-config-header__actions">
                    ${isHTTP ? `<button class="settings-btn settings-btn--secondary settings-btn-test"><i class="fas fa-vial"></i> 测试</button>` : ''}
                    <button class="settings-btn settings-btn--primary settings-btn-save"><i class="fas fa-save"></i> 保存</button>
                    <button class="settings-btn settings-btn--danger settings-btn-delete"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">基础信息</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label">名称</label>
                    <input type="text" class="settings-form__input" name="name" value="${skill.name}">
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">图标</label>
                    <input type="text" class="settings-form__input" name="icon" value="${skill.icon || ''}" placeholder="emoji 或留空">
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">描述</label>
                    <textarea class="settings-form__textarea" name="description">${skill.description || ''}</textarea>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">类型</label>
                    <select class="settings-form__select" name="type">
                        <option value="builtin" ${skill.type === 'builtin' ? 'selected' : ''}>Builtin（内置）</option>
                        <option value="http"    ${skill.type === 'http'    ? 'selected' : ''}>HTTP（远程端点）</option>
                        <option value="custom"  ${skill.type === 'custom'  ? 'selected' : ''}>Custom（自定义）</option>
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">
                        <input type="checkbox" name="enabled" ${skill.enabled ? 'checked' : ''}> 启用此 Skill
                    </label>
                </div>
            </div>

            <div class="settings-section" id="http-config-section" style="${isHTTP ? '' : 'display:none'}">
                <h3 class="settings-section__title">HTTP 端点配置</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label">Endpoint URL</label>
                    <input type="url" class="settings-form__input" name="endpoint" value="${skill.endpoint || ''}" placeholder="https://api.example.com/skill">
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">Method</label>
                    <select class="settings-form__select" name="method">
                        <option value="POST" ${(skill.method ?? 'POST') === 'POST' ? 'selected' : ''}>POST</option>
                        <option value="GET"  ${skill.method === 'GET'  ? 'selected' : ''}>GET</option>
                        <option value="PUT"  ${skill.method === 'PUT'  ? 'selected' : ''}>PUT</option>
                    </select>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">Headers (JSON)</label>
                    <textarea class="settings-form__textarea" name="headers" placeholder='{"Authorization": "Bearer token"}'>${skill.headers ? JSON.stringify(skill.headers, null, 2) : ''}</textarea>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">Function Parameters Schema</h3>
                <p class="settings-section__hint">JSON Schema（object 类型），描述 LLM 调用此 skill 时的参数格式。</p>
                <textarea class="settings-form__textarea settings-form__textarea--code" name="parameters" rows="8"
                    placeholder='{"type":"object","properties":{"query":{"type":"string","description":"查询内容"}},"required":["query"]}'
                >${paramsJson}</textarea>
            </div>
        `;
    }

    private renderEmptyState() {
        return `<div class="settings-empty"><h3>请选择或创建一个 Skill</h3></div>`;
    }

    private bindEvents() {
        this.clearListeners();

        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const item = (e.target as HTMLElement).closest('.settings-list-item') as HTMLElement;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
        }

        this.bindButton('#btn-add-skill',    () => this.addNewSkill());
        this.bindButton('#btn-create-first', () => this.addNewSkill());
        this.bindButton('#btn-import-skill', () => this.showImportModal());
        this.bindButton('#btn-export-skills',() => this.exportAll());
        this.bindButton('.settings-btn-save',   () => this.saveCurrentSkill());
        this.bindButton('.settings-btn-delete', () => this.deleteCurrentSkill());
        this.bindButton('.settings-btn-test',   () => this.testCurrentSkill());

        // 类型切换时显示/隐藏 HTTP 配置区
        const typeSelect = this.container.querySelector('[name="type"]');
        if (typeSelect) {
            this.addEventListener(typeSelect, 'change', (e) => {
                const isHTTP = (e.target as HTMLSelectElement).value === 'http';
                const section = document.getElementById('http-config-section');
                if (section) section.style.display = isHTTP ? '' : 'none';
            });
        }
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    // ─── Actions ──────────────────────────────────────────────────────────────

    private async addNewSkill() {
        const skill: LLMSkill = {
            id:      `skill-${generateShortUUID()}`,
            name:    'New Skill',
            type:    'http',
            enabled: false,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
        };
        await this.service.saveSkill(skill);
        this.selectedId = skill.id;
    }

    private async saveCurrentSkill() {
        if (!this.selectedId) return;
        const existing = (await this.service.getSkills()).find(s => s.id === this.selectedId);
        if (!existing) return;

        const getVal = (name: string) =>
            (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement)?.value ?? '';
        const getChk = (name: string) =>
            (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement)?.checked ?? false;

        let parameters: Record<string, unknown> | undefined;
        try {
            const raw = getVal('parameters').trim();
            parameters = raw ? JSON.parse(raw) : undefined;
        } catch {
            Toast.error('Parameters 不是合法 JSON');
            return;
        }

        let headers: Record<string, string> | undefined;
        try {
            const raw = getVal('headers').trim();
            headers = raw ? JSON.parse(raw) : undefined;
        } catch {
            Toast.error('Headers 不是合法 JSON');
            return;
        }

        const updated: LLMSkill = {
            ...existing,
            name:        getVal('name'),
            icon:        getVal('icon') || undefined,
            description: getVal('description') || undefined,
            type:        getVal('type') as LLMSkillType,
            enabled:     getChk('enabled'),
            endpoint:    getVal('endpoint') || undefined,
            method:      (getVal('method') as LLMSkill['method']) || undefined,
            headers,
            parameters,
        };

        await this.service.saveSkill(updated);
        Toast.success('已保存');
    }

    private deleteCurrentSkill() {
        if (!this.selectedId) return;
        Modal.confirm('确认删除', '确定要删除此 Skill 吗？', async () => {
            await this.service.deleteSkill(this.selectedId!);
            this.selectedId = null;
            Toast.success('已删除');
        });
    }

    private async testCurrentSkill() {
        if (!this.selectedId) return;
        const skill = (await this.service.getSkills()).find(s => s.id === this.selectedId);
        if (!skill || skill.type !== 'http' || !skill.endpoint) {
            Toast.error('请先配置 HTTP 端点');
            return;
        }

        const btn = this.container.querySelector('.settings-btn-test') as HTMLButtonElement;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '测试中...';
        btn.disabled = true;

        try {
            const res = await fetch(skill.endpoint, {
                method: skill.method ?? 'POST',
                headers: { 'Content-Type': 'application/json', ...skill.headers },
                body: JSON.stringify({}),
            });
            if (res.ok) {
                Toast.success(`连接成功（HTTP ${res.status}）`);
            } else {
                Toast.error(`HTTP ${res.status}`);
            }
        } catch (e: any) {
            Toast.error(`连接失败: ${e.message}`);
        } finally {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    }

    private showImportModal() {
        const content = `<textarea id="import-json" style="width:100%;height:200px" placeholder="粘贴 JSON 数组..."></textarea>`;
        new Modal('导入 Skills', content, {
            confirmText: '导入',
            onConfirm: async () => {
                const json = (document.getElementById('import-json') as HTMLTextAreaElement).value;
                try {
                    const data = JSON.parse(json);
                    const arr: LLMSkill[] = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id = item.id || `skill-${generateShortUUID()}`;
                        item.enabled = item.enabled ?? false;
                        await this.service.saveSkill(item);
                    }
                    Toast.success(`导入 ${arr.length} 个 Skill`);
                } catch {
                    Toast.error('JSON 格式错误');
                    return false;
                }
            },
        }).show();
    }

    private async exportAll() {
        const data = JSON.stringify(await this.service.getSkills(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'skills.json';
        a.click();
    }
}
