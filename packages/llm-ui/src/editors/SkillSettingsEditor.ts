// @file llm-ui/editors/SkillSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID } from '@itookit/common';
import type { LLMSkill, LLMSkillType, IAgentManagementService } from '@itookit/common';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<LLMSkillType, { label: string; icon: string; color: string }> = {
    prompt:  { label: 'Prompt',  icon: '📝',  color: '#10b981' },
    shell:   { label: 'Shell',   icon: '🖥️',  color: '#8b5cf6' },
    mcp:     { label: 'MCP',     icon: '🔌',  color: '#f97316' },
    http:    { label: 'HTTP',    icon: '🌐',  color: '#0ea5e9' },
    builtin: { label: 'Builtin', icon: '⚙️',  color: '#6366f1' },
    custom:  { label: 'Custom',  icon: '🔧',  color: '#f59e0b' },
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
        const [skills, mcpServers] = await Promise.all([
            this.service.getSkills(),
            this.service.getMCPServers?.() ?? Promise.resolve([]),
        ]);

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
                    ${selected ? this.renderDetail(selected, mcpServers) : this.renderEmptyState()}
                </div>
            </div>`;

        this.bindEvents(mcpServers);
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
                <div class="settings-list-item__info" style="min-width:0">
                    <div class="settings-list-item__title" data-name-for="${skill.id}"
                         title="双击重命名" style="cursor:text">${skill.name}</div>
                    <div class="settings-list-item__desc">${meta.label}${skill.endpoint ? ' · ' + this.shortUrl(skill.endpoint) : ''}</div>
                </div>
                ${enabledBadge(skill.enabled)}
            </div>`;
    }

    private shortUrl(url: string) {
        try { return new URL(url).hostname; } catch { return url.slice(0, 20); }
    }

    // ─── Detail ─────────────────────────────────────────────────────────────

    private renderDetail(skill: LLMSkill, mcpServers: import('@itookit/common').MCPServer[]) {
        const meta     = TYPE_META[skill.type] ?? TYPE_META.custom;
        const isHTTP   = skill.type === 'http';
        const isShell  = skill.type === 'shell';
        const isPrompt = skill.type === 'prompt';
        const isMCP    = skill.type === 'mcp';
        const params   = skill.parameters ? JSON.stringify(skill.parameters, null, 2) : '';

        return `
            <!-- ── Header ── -->
            <div style="padding:1.25rem 1.75rem;border-bottom:1px solid var(--st-border-color);
                        display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:1rem;min-width:0">
                    <span style="font-size:2.25rem;flex-shrink:0;line-height:1">${skill.icon || meta.icon}</span>
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                            <input name="header-name" value="${skill.name}"
                                placeholder="Skill 名称"
                                style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary);
                                       background:transparent;border:0;border-bottom:2px solid transparent;
                                       outline:none;padding:0 0 1px;font-family:inherit;
                                       width:auto;min-width:60px;max-width:280px;cursor:text;
                                       transition:border-color .15s"
                                title="点击编辑名称，Enter 或失焦保存">
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
                    <button class="settings-btn settings-btn--secondary" data-action="test" title="发送空请求测试连通性">
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
                                <option value="prompt"  ${skill.type === 'prompt'  ? 'selected' : ''}>📝 Prompt — Markdown 指令注入</option>
                                <option value="shell"   ${skill.type === 'shell'   ? 'selected' : ''}>🖥️ Shell — 本地命令执行</option>
                                <option value="mcp"     ${skill.type === 'mcp'     ? 'selected' : ''}>🔌 MCP — 引用 MCP Server 工具</option>
                                <option value="http"    ${skill.type === 'http'    ? 'selected' : ''}>🌐 HTTP — 远程 REST 端点</option>
                                <option value="builtin" ${skill.type === 'builtin' ? 'selected' : ''}>⚙️ Builtin — 代码内置函数</option>
                                <option value="custom"  ${skill.type === 'custom'  ? 'selected' : ''}>🔧 Custom — 自定义扩展</option>
                            </select>
                        </div>
                        <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                            <input type="checkbox" id="skill-enabled" name="enabled" ${skill.enabled ? 'checked' : ''}>
                            <label for="skill-enabled">启用此 Skill</label>
                        </div>
                    </div>
                </div>

                <!-- Prompt Instructions (type=prompt) -->
                <div class="settings-section" id="prompt-section" style="${isPrompt ? '' : 'display:none'}">
                    <h3 class="settings-section__title">Markdown 指令</h3>
                    <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                        此内容将注入到 LLM 的 system prompt。适合编写操作规范、代码风格约定、领域知识等。
                    </p>
                    <textarea class="settings-textarea" name="instructions" rows="14"
                        style="font-family:monospace;font-size:.8125rem;resize:vertical"
                        placeholder="# 操作规范&#10;&#10;- 永远使用 TypeScript strict 模式&#10;- 函数不超过 30 行&#10;..."
                        >${skill.instructions || ''}</textarea>
                </div>

                <!-- MCP Config (type=mcp) -->
                <div class="settings-section" id="mcp-section" style="${isMCP ? '' : 'display:none'}">
                    <h3 class="settings-section__title">MCP 工具引用</h3>
                    <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                        选择已配置的 MCP Server 和具体工具。端点、认证、参数 Schema 自动继承——比 HTTP Skill 更简洁。
                    </p>
                    <div class="settings-form-group">
                        <label>MCP Server</label>
                        <select class="settings-select" name="mcpServerId" id="mcp-server-select">
                            <option value="">— 选择服务器 —</option>
                            ${mcpServers.map(s => `
                                <option value="${s.id}" ${skill.mcpServerId === s.id ? 'selected' : ''}>
                                    ${s.icon || '🔌'} ${s.name}
                                </option>`).join('')}
                        </select>
                        ${mcpServers.length === 0 ? `
                            <p style="font-size:.75rem;color:var(--st-color-warning,#f59e0b);margin:.375rem 0 0">
                                <i class="fas fa-exclamation-triangle"></i>
                                尚无配置的 MCP Server，请先在 MCP Servers 标签页中添加
                            </p>` : ''}
                    </div>
                    <div class="settings-form-group" id="mcp-tool-group"
                         style="${skill.mcpServerId ? '' : 'display:none'}">
                        <label>工具</label>
                        <select class="settings-select" name="mcpToolName" id="mcp-tool-select">
                            <option value="">— 选择工具 —</option>
                            ${this.renderMcpToolOptions(skill.mcpServerId, skill.mcpToolName, mcpServers)}
                        </select>
                    </div>
                    ${skill.mcpServerId && skill.mcpToolName ? `
                        <div style="padding:.625rem .875rem;background:var(--st-surface-secondary,#f9fafb);
                                    border-radius:6px;font-size:.8125rem;color:var(--st-text-secondary)">
                            <i class="fas fa-info-circle"></i>
                            参数 Schema 由 MCP Server 的工具定义自动提供，无需手动填写。
                        </div>` : ''}
                </div>

                <!-- Shell Config (type=shell) -->
                <div class="settings-section" id="shell-section" style="${isShell ? '' : 'display:none'}">
                    <h3 class="settings-section__title">Shell 命令</h3>
                    <div class="settings-form-group">
                        <label>
                            命令模板
                            <span style="color:var(--st-text-tertiary);font-size:.8em">支持 {{argName}} 占位符</span>
                        </label>
                        <input class="settings-input" name="command" style="font-family:monospace"
                            value="${skill.command || ''}"
                            placeholder="git log --oneline -{{n}} -- {{path}}">
                    </div>
                    <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.25rem 0 0">
                        LLM 传入的参数会替换 <code>{{argName}}</code> 占位符后执行。在 Parameters Schema 中定义参数格式。
                    </p>
                </div>

                <!-- HTTP Config (type=http) -->
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

                <!-- Parameters Schema (http / shell only; prompt + mcp auto-derive) -->
                <div class="settings-section" id="params-section" style="${isPrompt || isMCP ? 'display:none' : ''};margin-bottom:0">
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

    private renderMcpToolOptions(
        serverId: string | undefined,
        selectedTool: string | undefined,
        mcpServers: import('@itookit/common').MCPServer[],
    ): string {
        if (!serverId) return '';
        const server = mcpServers.find(s => s.id === serverId);
        const tools = (server?.tools as any[] | undefined) ?? [];
        if (tools.length === 0) {
            return `<option value="" disabled>（该服务器暂无工具，请先连接）</option>`;
        }
        return tools.map((t: any) =>
            `<option value="${t.name}" ${selectedTool === t.name ? 'selected' : ''}>${t.name}${t.description ? ' — ' + t.description : ''}</option>`
        ).join('');
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

    private bindEvents(mcpServers: import('@itookit/common').MCPServer[]) {
        this.clearListeners();

        // ── Sidebar: single click = select, double click = inline rename ──────
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                // Ignore clicks inside an active rename input
                if ((e.target as HTMLElement).closest('.skill-inline-rename')) return;
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
            this.addEventListener(list, 'dblclick', (e) => {
                const titleEl = (e.target as HTMLElement).closest('[data-name-for]') as HTMLElement | null;
                if (titleEl) this.startInlineRename(titleEl, titleEl.dataset.nameFor!);
            });
        }

        // ── Header name input: focus style + sync + auto-save ─────────────────
        const headerInput = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
        const formInput   = this.container.querySelector<HTMLInputElement>('[name="name"]');
        if (headerInput) {
            this.addEventListener(headerInput, 'focus', () => {
                headerInput.style.borderBottomColor = 'var(--st-primary, #6366f1)';
            });
            this.addEventListener(headerInput, 'blur', () => {
                headerInput.style.borderBottomColor = 'transparent';
                this.saveNameOnly(headerInput.value.trim());
            });
            this.addEventListener(headerInput, 'keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter') headerInput.blur();
                if ((e as KeyboardEvent).key === 'Escape') {
                    headerInput.blur();
                }
            });
            // Keep form field in sync while typing
            if (formInput) {
                this.addEventListener(headerInput, 'input', () => {
                    formInput.value = headerInput.value;
                });
                this.addEventListener(formInput, 'input', () => {
                    headerInput.value = formInput.value;
                    // Resize header input to fit content
                    this.resizeHeaderInput(headerInput);
                });
            }
            this.resizeHeaderInput(headerInput);
        }

        // ── Action buttons ─────────────────────────────────────────────────────
        this.bindAction('add',    () => this.addNew());
        this.bindAction('import', () => this.showImport());
        this.bindAction('export', () => this.exportAll());
        this.bindAction('save',   () => this.saveCurrent());
        this.bindAction('delete', () => this.deleteCurrent());
        this.bindAction('test',   () => this.testCurrent());

        // ── Type select: show/hide config sections ─────────────────────────────
        const typeSelect = this.container.querySelector<HTMLSelectElement>('[name="type"]');
        if (typeSelect) {
            this.addEventListener(typeSelect, 'change', () => {
                const t = typeSelect.value;
                const show = (id: string, visible: boolean) => {
                    const el = this.container.querySelector<HTMLElement>(id);
                    if (el) el.style.display = visible ? '' : 'none';
                };
                show('#prompt-section', t === 'prompt');
                show('#shell-section',  t === 'shell');
                show('#mcp-section',    t === 'mcp');
                show('#http-section',   t === 'http');
                show('#params-section', t !== 'prompt' && t !== 'mcp');
            });
        }

        // ── MCP server select: update tool list ────────────────────────────────
        const mcpServerSel = this.container.querySelector<HTMLSelectElement>('#mcp-server-select');
        const mcpToolGroup = this.container.querySelector<HTMLElement>('#mcp-tool-group');
        const mcpToolSel   = this.container.querySelector<HTMLSelectElement>('#mcp-tool-select');
        if (mcpServerSel && mcpToolGroup && mcpToolSel) {
            this.addEventListener(mcpServerSel, 'change', () => {
                const serverId = mcpServerSel.value;
                mcpToolGroup.style.display = serverId ? '' : 'none';
                mcpToolSel.innerHTML =
                    '<option value="">— 选择工具 —</option>' +
                    this.renderMcpToolOptions(serverId, undefined, mcpServers);
            });
        }
    }

    /** Auto-size the header input to its content width. */
    private resizeHeaderInput(input: HTMLInputElement): void {
        // Use a temporary canvas measurement or the scrollWidth trick
        input.style.width = '4px';
        input.style.width = `${Math.min(input.scrollWidth + 4, 280)}px`;
    }

    /**
     * Save only the name field without a full re-render.
     * Updates the sidebar title and form field in-place.
     */
    private async saveNameOnly(newName: string): Promise<void> {
        if (!this.selectedId || !newName) return;
        const skills = await this.service.getSkills();
        const skill  = skills.find(s => s.id === this.selectedId);
        if (!skill || skill.name === newName) return;

        await this.service.saveSkill({ ...skill, name: newName, modifiedAt: Date.now() });

        // Patch sidebar without full re-render
        const sidebarTitle = this.container.querySelector<HTMLElement>(`[data-name-for="${this.selectedId}"]`);
        if (sidebarTitle && !sidebarTitle.querySelector('input')) {
            sidebarTitle.textContent = newName;
        }
        // Sync form field
        const formInput = this.container.querySelector<HTMLInputElement>('[name="name"]');
        if (formInput) formInput.value = newName;
    }

    /**
     * Replace a sidebar title element with an inline input for renaming.
     * Commits on Enter/blur, cancels on Escape.
     */
    private startInlineRename(titleEl: HTMLElement, skillId: string): void {
        if (titleEl.querySelector('input')) return; // already editing
        const original = titleEl.textContent?.trim() ?? '';

        const input = document.createElement('input');
        input.value = original;
        input.className = 'skill-inline-rename';
        input.style.cssText = [
            'width:100%', 'padding:0 2px', 'margin:0',
            'font-size:inherit', 'font-weight:inherit', 'font-family:inherit',
            'color:inherit', 'background:var(--st-input-bg,#fff)',
            'border:1px solid var(--st-primary,#6366f1)', 'border-radius:3px',
            'outline:none', 'line-height:1.4',
        ].join(';');

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.select();
        input.focus();

        let committed = false;
        const commit = async () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim() || original;
            // Restore text
            titleEl.textContent = newName;

            if (newName === original) return;
            const skills = await this.service.getSkills();
            const skill  = skills.find(s => s.id === skillId);
            if (!skill) return;
            await this.service.saveSkill({ ...skill, name: newName, modifiedAt: Date.now() });

            // Sync header + form if this is the currently selected skill
            if (skillId === this.selectedId) {
                const hdr = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
                const frm = this.container.querySelector<HTMLInputElement>('[name="name"]');
                if (hdr) { hdr.value = newName; this.resizeHeaderInput(hdr); }
                if (frm) frm.value = newName;
            }
        };

        const cancel = () => {
            committed = true;
            titleEl.textContent = original;
        };

        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // prevent list selection
            if (e.key === 'Enter')  { input.blur(); }
            if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
        });
    }

    /** Bind ALL elements with `data-action="<action>"` — fixes duplicate-button problem. */
    private bindAction(action: string, handler: () => void) {
        this.container.querySelectorAll(`[data-action="${action}"]`).forEach(el =>
            this.addEventListener(el, 'click', handler)
        );
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
            id:         `skill-${generateShortUUID()}`,
            name:       'New Skill',
            type:       'prompt',   // most common starting point
            enabled:    false,
            createdAt:  Date.now(),
            modifiedAt: Date.now(),
        };
        await this.service.saveSkill(skill);
        this.selectedId = skill.id;
        await this.render(); // ← refresh list + auto-select new item
    }

    private async saveCurrent() {
        if (!this.selectedId) return;

        // Fetch fresh data to avoid stale closure
        const skills  = await this.service.getSkills();
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
        const authVal = this.val('auth-header').trim();
        const rawHdrs = this.val('headers').trim();
        if (rawHdrs) {
            try { headers = JSON.parse(rawHdrs); }
            catch { Toast.error('Headers 不是合法 JSON'); return; }
        }
        if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

        const type = this.val('type') as LLMSkillType;
        const updated: LLMSkill = {
            ...existing,
            name:         this.val('header-name') || this.val('name') || existing.name,
            icon:         this.val('icon')         || undefined,
            description:  this.val('description') || undefined,
            type,
            enabled:      this.chk('enabled'),
            // prompt
            instructions: type === 'prompt' ? (this.val('instructions') || undefined) : undefined,
            // shell
            command:      type === 'shell'  ? (this.val('command')      || undefined) : undefined,
            // mcp
            mcpServerId:  type === 'mcp'    ? (this.val('mcpServerId')  || undefined) : undefined,
            mcpToolName:  type === 'mcp'    ? (this.val('mcpToolName')  || undefined) : undefined,
            // http
            endpoint:     type === 'http'   ? (this.val('endpoint')     || undefined) : undefined,
            method:       type === 'http'   ? ((this.val('method') || 'POST') as LLMSkill['method']) : undefined,
            headers:      type === 'http'   ? headers : undefined,
            // http / shell share parameters schema; mcp + prompt auto-derive
            parameters:   (type !== 'prompt' && type !== 'mcp') ? parameters : undefined,
            modifiedAt:   Date.now(),
        };
        await this.service.saveSkill(updated);
        Toast.success('已保存');
        await this.render(); // ← refresh badges in header and list item
    }

    private deleteCurrent() {
        if (!this.selectedId) return;
        Modal.confirm('删除确认', '确定要删除此 Skill？此操作不可撤销。', async () => {
            await this.service.deleteSkill(this.selectedId!);
            this.selectedId = null;
            Toast.success('已删除');
            await this.render(); // ← refresh list, clear detail panel
        });
    }

    private async testCurrent() {
        // Fetch fresh data so test always uses latest saved config
        const skills = await this.service.getSkills();
        const skill  = skills.find(s => s.id === this.selectedId);
        if (!skill) return;
        if (skill.type === 'prompt') { Toast.info('Prompt 类型 Skill 内容直接注入 system prompt，无需测试'); return; }
        if (skill.type === 'mcp')    { Toast.info('MCP Skill 通过 MCP Server 连接测试，请在 MCP Servers 标签页中测试服务器连通性'); return; }
        if (skill.type !== 'http')   { Toast.error('测试功能仅支持 HTTP 类型 Skill'); return; }
        if (!skill.endpoint)         { Toast.error('请先保存 Endpoint URL'); return; }

        const btn = this.container.querySelector<HTMLButtonElement>('[data-action="test"]');
        if (!btn) return;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中…';
        btn.disabled  = true;

        try {
            const res = await fetch(skill.endpoint, {
                method:  skill.method ?? 'POST',
                headers: { 'Content-Type': 'application/json', ...skill.headers },
                body:    JSON.stringify({}),
            });
            res.ok ? Toast.success(`连接成功 (HTTP ${res.status})`)
                   : Toast.error(`HTTP ${res.status} — 请检查 Endpoint`);
        } catch (e: unknown) {
            Toast.error(`连接失败: ${(e as Error).message}`);
        } finally {
            btn.innerHTML = originalHTML;
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
                const text = (document.getElementById('import-json') as HTMLTextAreaElement)?.value ?? '';
                try {
                    const data = JSON.parse(text);
                    const arr: LLMSkill[] = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id      = item.id      ?? `skill-${generateShortUUID()}`;
                        item.enabled = item.enabled ?? false;
                        await this.service.saveSkill(item);
                    }
                    Toast.success(`已导入 ${arr.length} 个 Skill`);
                    if (arr.length > 0) this.selectedId = arr[arr.length - 1].id;
                    await this.render(); // ← refresh after import
                } catch {
                    Toast.error('JSON 格式错误');
                    return false; // keep modal open
                }
            },
        }).show();
    }

    private async exportAll() {
        const skills = await this.service.getSkills(); // always export fresh data
        const blob   = new Blob([JSON.stringify(skills, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: 'skills.json',
        });
        a.click();
        URL.revokeObjectURL(a.href); // clean up object URL
    }
}
