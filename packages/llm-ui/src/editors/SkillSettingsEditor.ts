// @file llm-ui/editors/SkillSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID } from '@itookit/common';
import type { LLMSkill, LLMSkillType, IAgentManagementService } from '@itookit/common';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<LLMSkillType, { label: string; icon: string; color: string }> = {
    builtin: { label: 'Builtin',  icon: '⚙️',  color: '#6366f1' },
    http:    { label: 'HTTP',     icon: '🌐',  color: '#0ea5e9' },
    custom:  { label: 'Custom',   icon: '🔧',  color: '#f59e0b' },
};

function typeBadge(type: LLMSkillType) {
    const m = TYPE_META[type] ?? TYPE_META.custom;
    return `<span class="settings-badge" style="background:${m.color}15;color:${m.color};
                border:1px solid ${m.color}30;font-size:.75rem">
                ${m.icon} ${m.label}
            </span>`;
}

function enabledBadge(enabled: boolean) {
    return enabled
        ? `<span class="settings-badge settings-badge--success">启用</span>`
        : `<span class="settings-badge" style="color:var(--st-text-tertiary)">停用</span>`;
}

// ─── SkillSettingsEditor ──────────────────────────────────────────────────────

export class SkillSettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    private selectedId: string | null = null;

    async render() {
        const skills = await this.service.getSkills();

        if (this.selectedId && !skills.find(s => s.id === this.selectedId)) {
            this.selectedId = null;
        }
        if (!this.selectedId && skills.length > 0) {
            this.selectedId = skills[0].id;
        }

        const selected = skills.find(s => s.id === this.selectedId) ?? null;

        this.container.innerHTML = `
            <div class="settings-split">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3 style="margin:0;font-size:.9375rem;font-weight:600">
                            <i class="fas fa-bolt" style="margin-right:.5rem;opacity:.7"></i>Skills
                        </h3>
                        <div class="settings-page__actions">
                            <button class="settings-btn-round" data-action="add"    title="新建 Skill"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import" title="导入配置"><i class="fas fa-file-import"></i></button>
                            <button class="settings-btn-round" data-action="export" title="导出全部"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>

                    <div class="settings-split__list">
                        ${skills.length === 0 ? this.renderEmptyList() : skills.map(s => this.renderListItem(s)).join('')}
                    </div>
                </div>

                <div class="settings-split__content">
                    ${selected ? this.renderDetail(selected) : this.renderEmptyState()}
                </div>
            </div>`;

        this.bindEvents(skills);
    }

    // ─── List ───────────────────────────────────────────────────────────────

    private renderEmptyList() {
        return `
            <div class="settings-empty settings-empty--mini">
                <div class="settings-empty__icon" style="font-size:2rem">⚡</div>
                <p style="margin:.5rem 0">暂无 Skill</p>
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> 新建第一个
                </button>
            </div>`;
    }

    private renderListItem(skill: LLMSkill) {
        const isSelected = skill.id === this.selectedId;
        const meta = TYPE_META[skill.type] ?? TYPE_META.custom;
        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${skill.id}" style="cursor:pointer">
                <span class="settings-list-item__icon" style="font-size:1.25rem">${skill.icon || meta.icon}</span>
                <div class="settings-list-item__info">
                    <div class="settings-list-item__title">${skill.name}</div>
                    <div class="settings-list-item__desc">${meta.label}${skill.endpoint ? ' · ' + this.shortUrl(skill.endpoint) : ''}</div>
                </div>
                ${enabledBadge(skill.enabled)}
            </div>`;
    }

    private shortUrl(url: string) {
        try { return new URL(url).hostname; } catch { return url.slice(0, 20); }
    }

    // ─── Detail ─────────────────────────────────────────────────────────────

    private renderDetail(skill: LLMSkill) {
        const meta    = TYPE_META[skill.type] ?? TYPE_META.custom;
        const isHTTP  = skill.type === 'http';
        const params  = skill.parameters ? JSON.stringify(skill.parameters, null, 2) : '';

        return `
            <!-- ── Header ── -->
            <div style="padding:1.25rem 1.75rem;border-bottom:1px solid var(--st-border-color);
                        display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:1rem;min-width:0">
                    <span style="font-size:2.25rem;flex-shrink:0;line-height:1">${skill.icon || meta.icon}</span>
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                            <span style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary)">${skill.name}</span>
                            ${typeBadge(skill.type)}
                            ${enabledBadge(skill.enabled)}
                        </div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);margin-top:.125rem">
                            ${skill.description || '暂无描述'}
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:.5rem;flex-shrink:0">
                    ${isHTTP ? `
                    <button class="settings-btn settings-btn--secondary" data-action="test">
                        <i class="fas fa-vial"></i> 测试
                    </button>` : ''}
                    <button class="settings-btn settings-btn--primary" data-action="save">
                        <i class="fas fa-save"></i> 保存
                    </button>
                    <button class="settings-btn settings-btn--danger" data-action="delete" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <!-- ── Scrollable body ── -->
            <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

                <!-- Basic Info -->
                <div class="settings-section">
                    <h3 class="settings-section__title">基础信息</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                        <div class="settings-form-group">
                            <label>名称</label>
                            <input class="settings-input" name="name" value="${skill.name}" placeholder="My Skill">
                        </div>
                        <div class="settings-form-group">
                            <label>图标 <span style="color:var(--st-text-tertiary);font-size:.8em">emoji</span></label>
                            <input class="settings-input" name="icon" value="${skill.icon || ''}" placeholder="${meta.icon}">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>描述</label>
                        <textarea class="settings-textarea" name="description" rows="2"
                            placeholder="简述此 Skill 的功能">${skill.description || ''}</textarea>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>类型</label>
                            <select class="settings-select" name="type">
                                <option value="builtin" ${skill.type === 'builtin' ? 'selected' : ''}>⚙️ Builtin — 代码内置函数</option>
                                <option value="http"    ${skill.type === 'http'    ? 'selected' : ''}>🌐 HTTP — 远程 REST 端点</option>
                                <option value="custom"  ${skill.type === 'custom'  ? 'selected' : ''}>🔧 Custom — 自定义扩展</option>
                            </select>
                        </div>
                        <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                            <input type="checkbox" id="skill-enabled" name="enabled" ${skill.enabled ? 'checked' : ''}>
                            <label for="skill-enabled">启用此 Skill</label>
                        </div>
                    </div>
                </div>

                <!-- HTTP Config (conditional) -->
                <div class="settings-section" id="http-section" style="${isHTTP ? '' : 'display:none'}">
                    <h3 class="settings-section__title">HTTP 端点配置</h3>
                    <div class="settings-form-group">
                        <label>Endpoint URL</label>
                        <input class="settings-input" type="url" name="endpoint"
                            value="${skill.endpoint || ''}" placeholder="https://api.example.com/skill">
                    </div>
                    <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>Method</label>
                            <select class="settings-select" name="method">
                                <option value="POST" ${(skill.method ?? 'POST') === 'POST' ? 'selected' : ''}>POST</option>
                                <option value="GET"  ${skill.method === 'GET'  ? 'selected' : ''}>GET</option>
                                <option value="PUT"  ${skill.method === 'PUT'  ? 'selected' : ''}>PUT</option>
                            </select>
                        </div>
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>Authorization <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                            <input class="settings-input" type="password" name="auth-header"
                                value="${skill.headers?.Authorization || ''}" placeholder="Bearer sk-...">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>
                            额外请求头
                            <span style="color:var(--st-text-tertiary);font-size:.8em">JSON，不含 Authorization</span>
                        </label>
                        <textarea class="settings-textarea" name="headers" rows="3"
                            style="font-family:monospace;font-size:.8125rem"
                            placeholder='{"X-Custom-Header": "value"}'>${this.headersWithoutAuth(skill.headers)}</textarea>
                    </div>
                </div>

                <!-- Parameters Schema -->
                <div class="settings-section" style="margin-bottom:0">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        Parameters Schema
                        <span style="font-size:.75rem;font-weight:400;color:var(--st-text-tertiary)">
                            JSON Schema — LLM 调用此 Skill 的参数格式
                        </span>
                    </h3>
                    <textarea class="settings-textarea" name="parameters" rows="10"
                        style="font-family:monospace;font-size:.8125rem;resize:vertical"
                        placeholder='{\n  "type": "object",\n  "properties": {\n    "query": {\n      "type": "string",\n      "description": "搜索关键词"\n    }\n  },\n  "required": ["query"]\n}'>${params}</textarea>
                    <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.375rem 0 0">
                        留空则 LLM 将以无参数形式调用此 Skill
                    </p>
                </div>
            </div>`;
    }

    private headersWithoutAuth(headers?: Record<string, string>): string {
        if (!headers) return '';
        const { Authorization, ...rest } = headers;
        return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
    }

    private renderEmptyState() {
        return `
            <div class="settings-empty" style="height:100%;justify-content:center">
                <div class="settings-empty__icon">⚡</div>
                <div class="settings-empty__title">选择一个 Skill</div>
                <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                    Skills 让 LLM 能够调用 HTTP API、内置函数或自定义代码
                </p>
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> 新建 Skill
                </button>
            </div>`;
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private bindEvents(skills: LLMSkill[]) {
        this.clearListeners();

        // List selection
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
        }

        this.bindAction('add',    () => this.addNew());
        this.bindAction('import', () => this.showImport());
        this.bindAction('export', () => this.exportAll(skills));
        this.bindAction('save',   () => this.saveCurrent(skills));
        this.bindAction('delete', () => this.deleteCurrent());
        this.bindAction('test',   () => this.testCurrent(skills));

        // Show/hide HTTP section when type changes
        const typeSelect = this.container.querySelector<HTMLSelectElement>('[name="type"]');
        if (typeSelect) {
            this.addEventListener(typeSelect, 'change', () => {
                const sec = this.container.querySelector<HTMLElement>('#http-section');
                if (sec) sec.style.display = typeSelect.value === 'http' ? '' : 'none';
            });
        }
    }

    private bindAction(action: string, handler: () => void) {
        const el = this.container.querySelector(`[data-action="${action}"]`);
        if (el) this.addEventListener(el, 'click', handler);
    }

    private val(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    }
    private chk(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.checked ?? false;
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    private async addNew() {
        const skill: LLMSkill = {
            id:        `skill-${generateShortUUID()}`,
            name:      'New Skill',
            type:      'http',
            enabled:   false,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
        };
        await this.service.saveSkill(skill);
        this.selectedId = skill.id;
    }

    private async saveCurrent(skills: LLMSkill[]) {
        if (!this.selectedId) return;
        const existing = skills.find(s => s.id === this.selectedId);
        if (!existing) return;

        // Parse parameters JSON
        let parameters: Record<string, unknown> | undefined;
        const rawParams = this.val('parameters').trim();
        if (rawParams) {
            try { parameters = JSON.parse(rawParams); }
            catch { Toast.error('Parameters 不是合法 JSON'); return; }
        }

        // Build headers (merge Authorization back in)
        let headers: Record<string, string> | undefined;
        const authVal   = this.val('auth-header').trim();
        const rawHdrs   = this.val('headers').trim();
        if (rawHdrs) {
            try { headers = JSON.parse(rawHdrs); }
            catch { Toast.error('Headers 不是合法 JSON'); return; }
        }
        if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

        const updated: LLMSkill = {
            ...existing,
            name:        this.val('name')        || existing.name,
            icon:        this.val('icon')        || undefined,
            description: this.val('description') || undefined,
            type:        this.val('type')        as LLMSkillType,
            enabled:     this.chk('enabled'),
            endpoint:    this.val('endpoint')    || undefined,
            method:      (this.val('method')     || 'POST') as LLMSkill['method'],
            headers,
            parameters,
            modifiedAt:  Date.now(),
        };
        await this.service.saveSkill(updated);
        Toast.success('已保存');
    }

    private deleteCurrent() {
        if (!this.selectedId) return;
        Modal.confirm('删除确认', '确定要删除此 Skill？此操作不可撤销。', async () => {
            await this.service.deleteSkill(this.selectedId!);
            this.selectedId = null;
            Toast.success('已删除');
        });
    }

    private async testCurrent(skills: LLMSkill[]) {
        const skill = skills.find(s => s.id === this.selectedId);
        if (!skill || skill.type !== 'http') { Toast.error('仅 HTTP 类型 Skill 支持测试'); return; }
        if (!skill.endpoint) { Toast.error('请先配置 Endpoint URL'); return; }

        const btn = this.container.querySelector<HTMLButtonElement>('[data-action="test"]');
        if (!btn) return;
        const html = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中…';
        btn.disabled  = true;

        try {
            const res = await fetch(skill.endpoint, {
                method:  skill.method ?? 'POST',
                headers: { 'Content-Type': 'application/json', ...skill.headers },
                body:    JSON.stringify({}),
            });
            res.ok ? Toast.success(`连接成功 (HTTP ${res.status})`)
                   : Toast.error(`HTTP ${res.status}`);
        } catch (e: any) {
            Toast.error(`连接失败: ${e.message}`);
        } finally {
            btn.innerHTML = html;
            btn.disabled  = false;
        }
    }

    private showImport() {
        const body = `
            <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                粘贴 JSON 数组或单个对象</p>
            <textarea class="settings-textarea" id="import-json" rows="8"
                style="font-family:monospace;font-size:.8125rem"
                placeholder='[{"name":"My Skill","type":"http","endpoint":"..."}]'></textarea>`;
        new Modal('导入 Skills', body, {
            confirmText: '导入',
            onConfirm: async () => {
                const text = (document.getElementById('import-json') as HTMLTextAreaElement).value;
                try {
                    const data = JSON.parse(text);
                    const arr: LLMSkill[] = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id      = item.id ?? `skill-${generateShortUUID()}`;
                        item.enabled = item.enabled ?? false;
                        await this.service.saveSkill(item);
                    }
                    Toast.success(`已导入 ${arr.length} 个 Skill`);
                } catch {
                    Toast.error('JSON 格式错误');
                    return false;
                }
            },
        }).show();
    }

    private async exportAll(skills: LLMSkill[]) {
        const blob = new Blob([JSON.stringify(skills, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: 'skills.json',
        });
        a.click();
    }
}
