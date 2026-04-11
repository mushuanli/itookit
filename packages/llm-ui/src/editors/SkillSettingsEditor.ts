// @file llm-ui/editors/SkillSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID, t, SKILL_TYPE_META, ENTITY_ICONS } from '@itookit/common';
import type { LLMSkill, LLMSkillType, IAgentManagementService } from '@itookit/common';
import yaml from 'js-yaml';

function typeBadge(type: LLMSkillType) {
    const m = SKILL_TYPE_META[type] ?? SKILL_TYPE_META.custom;
    const label = t(`skillType.${type}` as Parameters<typeof t>[0]);
    return `<span class="settings-badge" style="background:${m.color}15;color:${m.color};
                border:1px solid ${m.color}30;font-size:.75rem">
                ${m.icon} ${label}
            </span>`;
}

function enabledBadge(enabled: boolean) {
    return enabled
        ? `<span class="settings-badge settings-badge--success">${t('status.enabled')}</span>`
        : `<span class="settings-badge" style="color:var(--st-text-tertiary)">${t('status.disabled')}</span>`;
}

// ─── SkillSettingsEditor ──────────────────────────────────────────────────────

export class SkillSettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    private selectedId: string | null = null;
    /** True while a batch import is in progress — suppresses onChange-triggered renders. */
    private _importing = false;
    /** IDs checked for multi-select batch actions. */
    private _checkedIds = new Set<string>();
    /**
     * Form-only mode: renders just the detail panel (no sidebar).
     * Used when Skills is a standalone VFSUIShell workspace — the sidebar is
     * provided by VFSUIShell itself; this editor handles only the right panel.
     */
    private _formOnly = false;

    /**
     * Factory for form-only mode (used by the Skills workspace EditorFactory).
     * VFSUIShell calls init(container, yamlContent) where yamlContent comes from
     * SkillsEngine.readContent(skillId).
     */
    static createFormOnly(
        container: HTMLElement,
        service: IAgentManagementService,
        options?: import('@itookit/common').EditorOptions,
    ): SkillSettingsEditor {
        const editor = new SkillSettingsEditor(container, service, options ?? {});
        editor._formOnly = true;
        // Prefer options.nodeId (always accurate) over parsing options.initialContent YAML.
        // In formOnly mode, options.nodeId IS the skill ID from SkillsEngine.
        if (options?.nodeId) editor.selectedId = options.nodeId;
        return editor;
    }

    // ── IEditor: init override (sets selectedId from YAML content in form-only mode) ──

    async init(container: HTMLElement, content?: string): Promise<void> {
        if (this._formOnly && content?.trim()) {
            try {
                const skill = yaml.load(content) as { id?: string };
                if (skill?.id) this.selectedId = skill.id;
            } catch { /* ignore malformed YAML */ }
        }
        await super.init(container, content);
    }

    // ── IEditor: getText() — returns skill YAML for auto-save by editor-connector ──

    getText(): string {
        if (!this._formOnly || !this.selectedId) return '';
        const type = this.val('type') as LLMSkillType;
        let parameters: Record<string, unknown> | undefined;
        const rawParams = this.val('parameters').trim();
        if (rawParams) { try { parameters = JSON.parse(rawParams); } catch { /* invalid */ } }

        const authVal = this.val('auth-header').trim();
        const rawHdrs = this.val('headers').trim();
        let headers: Record<string, string> | undefined;
        if (rawHdrs) { try { headers = JSON.parse(rawHdrs); } catch { /* invalid */ } }
        if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

        const skill: LLMSkill = {
            id:           this.selectedId,
            name:         this.val('header-name') || this.val('name') || this.selectedId,
            icon:         this.val('icon') || undefined,
            description:  this.val('description') || undefined,
            type,
            enabled:      this.chk('enabled'),
            instructions: type === 'prompt' ? (this.val('instructions') || undefined) : undefined,
            command:      type === 'shell'  ? (this.val('command')      || undefined) : undefined,
            mcpServerId:  type === 'mcp'    ? (this.val('mcpServerId')  || undefined) : undefined,
            mcpToolName:  type === 'mcp'    ? (this.val('mcpToolName')  || undefined) : undefined,
            endpoint:     type === 'http'   ? (this.val('endpoint')     || undefined) : undefined,
            method:       type === 'http'   ? ((this.val('method') || 'POST') as LLMSkill['method']) : undefined,
            headers:      type === 'http'   ? headers : undefined,
            parameters:   (type !== 'prompt' && type !== 'mcp') ? parameters : undefined,
            modifiedAt:   Date.now(),
        };
        return yaml.dump(skill, { lineWidth: -1, noRefs: true });
    }

    async render() {
        // During batch import, each saveSkill triggers notify() → render().
        // Suppress those intermediate renders; the import loop calls render() once at the end.
        if (this._importing) return;

        // Form-only mode: no sidebar — render just the detail panel for selectedId.
        if (this._formOnly) {
            return this._renderFormOnly();
        }

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
                            <button class="settings-btn-round" data-action="add"          title="${t('skill.addNew')}"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import"       title="${t('skill.import.fileTooltip')}"><i class="fas fa-folder-open"></i></button>
                            <button class="settings-btn-round" data-action="import-paste" title="${t('skill.import.pasteTooltip')}"><i class="fas fa-clipboard"></i></button>
                            <button class="settings-btn-round" data-action="export"       title="${t('skill.exportAll')}"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>

                    ${this._checkedIds.size > 0 ? `
                    <div style="display:flex;align-items:center;gap:.5rem;padding:.375rem .75rem;
                                background:var(--st-color-primary-bg,#eef2ff);border-bottom:1px solid var(--st-border-color)">
                        <span style="font-size:.8125rem;font-weight:500;flex:1">${this._checkedIds.size} selected</span>
                        <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="batch-export">
                            <i class="fas fa-file-export"></i> Export
                        </button>
                        <button class="settings-btn settings-btn--danger settings-btn--sm" data-action="batch-delete">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                        <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="batch-clear"
                                title="Clear selection" style="padding:.25rem .5rem">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>` : ''}
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
                <div class="settings-empty__icon" style="font-size:2rem">${ENTITY_ICONS.skill}</div>
                <p style="margin:.5rem 0">${t('skill.empty.text')}</p>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                    <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                        <i class="fas fa-plus"></i> ${t('skill.empty.action')}
                    </button>
                    <button class="settings-btn settings-btn--secondary settings-btn--sm" data-action="import">
                        <i class="fas fa-folder-open"></i> ${t('skill.import.fileLabel')}
                    </button>
                </div>
            </div>`;
    }

    private renderListItem(skill: LLMSkill) {
        const isSelected = skill.id === this.selectedId;
        const isChecked  = this._checkedIds.has(skill.id);
        const meta = SKILL_TYPE_META[skill.type] ?? SKILL_TYPE_META.custom;
        const typeLabel = t(`skillType.${skill.type}` as Parameters<typeof t>[0]);
        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${skill.id}" style="cursor:pointer">
                <input type="checkbox" class="settings-list-item__check" data-check-id="${skill.id}"
                       ${isChecked ? 'checked' : ''}
                       style="flex-shrink:0;margin:0;cursor:pointer;accent-color:var(--st-color-primary,#6366f1)"
                       title="Select for batch action"
                       onclick="event.stopPropagation()">
                <span class="settings-list-item__icon" style="font-size:1.25rem">${skill.icon || meta.icon}</span>
                <div class="settings-list-item__info" style="min-width:0">
                    <div class="settings-list-item__title" data-name-for="${skill.id}"
                         title="${t('tooltip.dblClickRename')}" style="cursor:text">${skill.name}</div>
                    <div class="settings-list-item__desc">${typeLabel}${skill.endpoint ? ' · ' + this.shortUrl(skill.endpoint) : ''}</div>
                    <div style="font-family:monospace;font-size:.7rem;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${skill.id}</div>
                </div>
                ${enabledBadge(skill.enabled)}
            </div>`;
    }

    private shortUrl(url: string) {
        try { return new URL(url).hostname; } catch { return url.slice(0, 20); }
    }

    // ─── Detail ─────────────────────────────────────────────────────────────

    private renderDetail(skill: LLMSkill, mcpServers: import('@itookit/common').MCPServer[]) {
        const meta     = SKILL_TYPE_META[skill.type] ?? SKILL_TYPE_META.custom;
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
                                placeholder="${t('skill.placeholder.name')}"
                                style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary);
                                       background:transparent;border:0;border-bottom:2px solid transparent;
                                       outline:none;padding:0 0 1px;font-family:inherit;
                                       width:auto;min-width:60px;max-width:280px;cursor:text;
                                       transition:border-color .15s"
                                title="${t('tooltip.clickEditName')}">
                            ${typeBadge(skill.type)}
                            ${enabledBadge(skill.enabled)}
                        </div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);margin-top:.125rem">
                            ${skill.description || t('status.noDesc')}
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:.5rem;flex-shrink:0">
                    ${isHTTP ? `
                    <button class="settings-btn settings-btn--secondary" data-action="test" title="${t('tooltip.testConnection')}">
                        <i class="fas fa-vial"></i> ${t('action.test')}
                    </button>` : ''}
                    <button class="settings-btn settings-btn--primary" data-action="save">
                        <i class="fas fa-save"></i> ${t('action.save')}
                    </button>
                    <button class="settings-btn settings-btn--danger" data-action="delete" title="${t('action.delete')}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <!-- ── Scrollable body ── -->
            <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

                <!-- Basic Info -->
                <div class="settings-section">
                    <h3 class="settings-section__title">${t('skill.section.basic')}</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                        <div class="settings-form-group">
                            <label>${t('form.name')}</label>
                            <input class="settings-input" name="name" value="${skill.name}" placeholder="${t('skill.placeholder.name')}">
                        </div>
                        <div class="settings-form-group">
                            <label>${t('form.icon')} <span style="color:var(--st-text-tertiary);font-size:.8em">emoji</span></label>
                            <input class="settings-input" name="icon" value="${skill.icon || ''}" placeholder="${meta.icon}">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>ID <span style="color:var(--st-text-tertiary);font-size:.8em">lowercase letters, numbers, hyphens</span></label>
                        <input class="settings-input" name="id" value="${skill.id}"
                               placeholder="my-skill-id"
                               style="font-family:monospace;font-size:.875rem"
                               pattern="[a-z0-9][a-z0-9_-]*" title="Lowercase letters, numbers, hyphens">
                    </div>
                    <div class="settings-form-group">
                        <label>${t('form.description')}</label>
                        <textarea class="settings-textarea" name="description" rows="2"
                            placeholder="${t('skill.placeholder.desc')}">${skill.description || ''}</textarea>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:end">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>${t('form.type')}</label>
                            <select class="settings-select" name="type">
                                <option value="prompt"  ${skill.type === 'prompt'  ? 'selected' : ''}>${SKILL_TYPE_META.prompt.icon} Prompt — ${t('skillType.prompt.desc')}</option>
                                <option value="shell"   ${skill.type === 'shell'   ? 'selected' : ''}>${SKILL_TYPE_META.shell.icon} Shell — ${t('skillType.shell.desc')}</option>
                                <option value="mcp"     ${skill.type === 'mcp'     ? 'selected' : ''}>${SKILL_TYPE_META.mcp.icon} MCP — ${t('skillType.mcp.desc')}</option>
                                <option value="http"    ${skill.type === 'http'    ? 'selected' : ''}>${SKILL_TYPE_META.http.icon} HTTP — ${t('skillType.http.desc')}</option>
                                <option value="builtin" ${skill.type === 'builtin' ? 'selected' : ''}>${SKILL_TYPE_META.builtin.icon} Builtin — ${t('skillType.builtin.desc')}</option>
                                <option value="custom"  ${skill.type === 'custom'  ? 'selected' : ''}>${SKILL_TYPE_META.custom.icon} Custom — ${t('skillType.custom.desc')}</option>
                            </select>
                        </div>
                        <div class="settings-checkbox-row" style="padding-bottom:.5rem;white-space:nowrap">
                            <input type="checkbox" id="skill-enabled" name="enabled" ${skill.enabled ? 'checked' : ''}>
                            <label for="skill-enabled">${t('skill.enabled.label')}</label>
                        </div>
                    </div>
                </div>

                <!-- Prompt Instructions (type=prompt) -->
                <div class="settings-section" id="prompt-section" style="${isPrompt ? '' : 'display:none'}">
                    <h3 class="settings-section__title">${t('skill.section.prompt')}</h3>
                    <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                        ${t('skill.hint.prompt')}
                    </p>
                    <textarea class="settings-textarea" name="instructions" rows="14"
                        style="font-family:monospace;font-size:.8125rem;resize:vertical"
                        placeholder="${t('skill.placeholder.instructions').replace(/\\n/g, '&#10;')}"
                        >${skill.instructions || ''}</textarea>
                </div>

                <!-- MCP Config (type=mcp) -->
                <div class="settings-section" id="mcp-section" style="${isMCP ? '' : 'display:none'}">
                    <h3 class="settings-section__title">${t('skill.section.mcp')}</h3>
                    <p style="font-size:.8125rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                        ${t('skill.hint.mcpDesc')}
                    </p>
                    <div class="settings-form-group">
                        <label>${t('skill.mcp.serverLabel')}</label>
                        <select class="settings-select" name="mcpServerId" id="mcp-server-select">
                            <option value="">${t('skill.mcp.serverEmpty')}</option>
                            ${mcpServers.map(s => `
                                <option value="${s.id}" ${skill.mcpServerId === s.id ? 'selected' : ''}>
                                    ${s.icon || '🔌'} ${s.name}
                                </option>`).join('')}
                        </select>
                        ${mcpServers.length === 0 ? `
                            <p style="font-size:.75rem;color:var(--st-color-warning,#f59e0b);margin:.375rem 0 0">
                                <i class="fas fa-exclamation-triangle"></i>
                                ${t('skill.hint.noMcpServer')}
                            </p>` : ''}
                    </div>
                    <div class="settings-form-group" id="mcp-tool-group"
                         style="${skill.mcpServerId ? '' : 'display:none'}">
                        <label>${t('skill.mcp.toolLabel')}</label>
                        <select class="settings-select" name="mcpToolName" id="mcp-tool-select">
                            <option value="">${t('skill.mcp.toolEmpty')}</option>
                            ${this.renderMcpToolOptions(skill.mcpServerId, skill.mcpToolName, mcpServers)}
                        </select>
                    </div>
                    ${skill.mcpServerId && skill.mcpToolName ? `
                        <div style="padding:.625rem .875rem;background:var(--st-surface-secondary,#f9fafb);
                                    border-radius:6px;font-size:.8125rem;color:var(--st-text-secondary)">
                            <i class="fas fa-info-circle"></i>
                            ${t('skill.hint.mcpAutoParams')}
                        </div>` : ''}
                </div>

                <!-- Shell Config (type=shell) -->
                <div class="settings-section" id="shell-section" style="${isShell ? '' : 'display:none'}">
                    <h3 class="settings-section__title">${t('skill.section.shell')}</h3>
                    <div class="settings-form-group">
                        <label>
                            ${t('skill.shell.commandLabel')}
                            <span style="color:var(--st-text-tertiary);font-size:.8em">${t('skill.shell.commandHint')}</span>
                        </label>
                        <input class="settings-input" name="command" style="font-family:monospace"
                            value="${skill.command || ''}"
                            placeholder="${t('skill.shell.placeholder')}">
                    </div>
                    <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.25rem 0 0">
                        ${t('skill.hint.shell')}
                    </p>
                </div>

                <!-- HTTP Config (type=http) -->
                <div class="settings-section" id="http-section" style="${isHTTP ? '' : 'display:none'}">
                    <h3 class="settings-section__title">${t('skill.section.http')}</h3>
                    <div class="settings-form-group">
                        <label>${t('form.endpoint')}</label>
                        <input class="settings-input" type="url" name="endpoint"
                            value="${skill.endpoint || ''}" placeholder="https://api.example.com/skill">
                    </div>
                    <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>${t('form.method')}</label>
                            <select class="settings-select" name="method">
                                <option value="POST" ${(skill.method ?? 'POST') === 'POST' ? 'selected' : ''}>POST</option>
                                <option value="GET"  ${skill.method === 'GET'  ? 'selected' : ''}>GET</option>
                                <option value="PUT"  ${skill.method === 'PUT'  ? 'selected' : ''}>PUT</option>
                            </select>
                        </div>
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>${t('form.auth')} <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                            <input class="settings-input" type="password" name="auth-header"
                                value="${skill.headers?.Authorization || ''}" placeholder="Bearer sk-...">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>
                            ${t('form.headers')}
                            <span style="color:var(--st-text-tertiary);font-size:.8em">${t('form.headersHint')}</span>
                        </label>
                        <textarea class="settings-textarea" name="headers" rows="3"
                            style="font-family:monospace;font-size:.8125rem"
                            placeholder='{"X-Custom-Header": "value"}'>${this.headersWithoutAuth(skill.headers)}</textarea>
                    </div>
                </div>

                <!-- Parameters Schema (http / shell only; prompt + mcp auto-derive) -->
                <div class="settings-section" id="params-section" style="${isPrompt || isMCP ? 'display:none' : ''};margin-bottom:0">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        ${t('skill.section.params')}
                        <span style="font-size:.75rem;font-weight:400;color:var(--st-text-tertiary)">
                            JSON Schema
                        </span>
                    </h3>
                    <textarea class="settings-textarea" name="parameters" rows="10"
                        style="font-family:monospace;font-size:.8125rem;resize:vertical"
                        placeholder="${t('skill.param.placeholder')}">${params}</textarea>
                    <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:.375rem 0 0">
                        ${t('skill.hint.params')}
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
            return `<option value="" disabled>${t('skill.hint.noMcpTools')}</option>`;
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
                <div class="settings-empty__icon">${ENTITY_ICONS.skill}</div>
                <div class="settings-empty__title">${t('skill.select.title')}</div>
                <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                    ${t('skill.select.desc')}
                </p>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
                    <button class="settings-btn settings-btn--primary" data-action="add">
                        <i class="fas fa-plus"></i> ${t('skill.select.action')}
                    </button>
                    <button class="settings-btn settings-btn--secondary" data-action="import">
                        <i class="fas fa-folder-open"></i> ${t('skill.import.fileLabel')}
                    </button>
                </div>
            </div>`;
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private bindEvents(mcpServers: import('@itookit/common').MCPServer[]) {
        this.clearListeners();

        // ── Sidebar: checkbox = multi-select, click = single-select, dblclick = rename ──
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'change', (e) => {
                const cb = (e.target as HTMLElement).closest('[data-check-id]') as HTMLInputElement | null;
                if (!cb) return;
                const id = cb.dataset.checkId!;
                if (cb.checked) this._checkedIds.add(id);
                else this._checkedIds.delete(id);
                this.render(); // re-render to show/hide batch bar
            });
            this.addEventListener(list, 'click', (e) => {
                // Ignore clicks inside an active rename input or on checkboxes
                if ((e.target as HTMLElement).closest('.skill-inline-rename')) return;
                if ((e.target as HTMLElement).closest('[data-check-id]')) return;
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
            this.addEventListener(list, 'dblclick', (e) => {
                const titleEl = (e.target as HTMLElement).closest('[data-name-for]') as HTMLElement | null;
                if (titleEl) this.startInlineRename(titleEl, titleEl.dataset.nameFor!);
            });
        }

        // ── Batch actions ────────────────────────────────────────────────────
        this.bindAction('batch-clear',  () => { this._checkedIds.clear(); this.render(); });
        this.bindAction('batch-delete', () => this.batchDelete());
        this.bindAction('batch-export', () => this.batchExport());

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
        this.bindAction('add',          () => this.addNew());
        this.bindAction('import',       () => this.showImport());
        this.bindAction('import-paste', () => this.showPasteImport());
        this.bindAction('export',       () => this.exportAll());
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
                    `<option value="">${t('skill.mcp.toolEmpty')}</option>` +
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
            catch { Toast.error(t('skill.toast.invalidParams')); return; }
        }

        // Build headers (merge Authorization back in)
        let headers: Record<string, string> | undefined;
        const authVal = this.val('auth-header').trim();
        const rawHdrs = this.val('headers').trim();
        if (rawHdrs) {
            try { headers = JSON.parse(rawHdrs); }
            catch { Toast.error(t('skill.toast.invalidHeaders')); return; }
        }
        if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

        const type = this.val('type') as LLMSkillType;
        // Validate and resolve new ID
        const rawId  = this.val('id').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const newId  = rawId || existing.id;
        const idChanged = newId !== existing.id;

        if (idChanged) {
            // Check for conflicts with other skills
            const conflict = skills.find(s => s.id === newId);
            if (conflict) {
                Toast.error(`ID "${newId}" is already used by "${conflict.name}"`);
                return;
            }
        }

        const updated: LLMSkill = {
            ...existing,
            id:           newId,
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

        if (idChanged) {
            // Rename: save under new ID then delete old
            await this.service.saveSkill(updated);
            await this.service.deleteSkill(existing.id);
            this.selectedId = newId;
        } else {
            await this.service.saveSkill(updated);
        }
        Toast.success(t('skill.toast.saved'));
        await this.render(); // ← refresh badges in header and list item
    }

    private deleteCurrent() {
        if (!this.selectedId) return;
        Modal.confirm(t('dialog.delete.title'), t('skill.confirm.delete'), async () => {
            await this.service.deleteSkill(this.selectedId!);
            this.selectedId = null;
            Toast.success(t('skill.toast.deleted'));
            await this.render(); // ← refresh list, clear detail panel
        });
    }

    private async testCurrent() {
        // Fetch fresh data so test always uses latest saved config
        const skills = await this.service.getSkills();
        const skill  = skills.find(s => s.id === this.selectedId);
        if (!skill) return;
        if (skill.type === 'prompt') { Toast.info(t('skill.toast.testPrompt')); return; }
        if (skill.type === 'mcp')    { Toast.info(t('skill.toast.testMcp')); return; }
        if (skill.type !== 'http')   { Toast.error(t('skill.toast.testNotHttp')); return; }
        if (!skill.endpoint)         { Toast.error(t('skill.toast.testNoEndpoint')); return; }

        const btn = this.container.querySelector<HTMLButtonElement>('[data-action="test"]');
        if (!btn) return;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('status.testing')}`;
        btn.disabled  = true;

        try {
            const res = await fetch(skill.endpoint, {
                method:  skill.method ?? 'POST',
                headers: { 'Content-Type': 'application/json', ...skill.headers },
                body:    JSON.stringify({}),
            });
            res.ok ? Toast.success(t('skill.toast.testSuccess', { status: res.status }))
                   : Toast.error(t('skill.toast.testFailed', { status: res.status }));
        } catch (e: unknown) {
            Toast.error(t('skill.toast.testError', { message: (e as Error).message }));
        } finally {
            btn.innerHTML = originalHTML;
            btn.disabled  = false;
        }
    }

    /**
     * Import via file picker (primary) or paste JSON (secondary).
     *
     * A hidden <input type="file"> is created on demand and immediately clicked.
     * Each selected file may contain a single LLMSkill object or an array.
     * All files are read in parallel and their skills are imported in one batch.
     *
     * After file import, a "Paste JSON" fallback is still available via a
     * secondary action shown in the import result area.
     */
    private showImport() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,.yaml,.yml,application/json';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files ?? []);
            document.body.removeChild(fileInput);
            if (files.length === 0) return;

            const results = await Promise.allSettled(
                files.map(f => f.text()),
            );

            const skills: LLMSkill[] = [];
            const errors: string[] = [];

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status === 'rejected') {
                    errors.push(t('skill.import.readError', { filename: files[i].name }));
                    continue;
                }
                try {
                    const name = files[i].name;
                    const isYaml = name.endsWith('.yaml') || name.endsWith('.yml');
                    const data = isYaml ? yaml.load(r.value) : JSON.parse(r.value);
                    const arr: LLMSkill[] = Array.isArray(data) ? data as LLMSkill[] : [data as LLMSkill];
                    skills.push(...arr);
                } catch {
                    errors.push(`${files[i].name}: ${t('skill.toast.invalidJson')}`);
                }
            }

            if (errors.length > 0) {
                Toast.error(errors.join('\n'));
            }

            if (skills.length === 0) return;

            // Suppress onChange-triggered re-renders while batch-saving to avoid
            // showing partial state (e.g. only 1 of 3 skills) between saves.
            this._importing = true;
            // Snapshot existing IDs to detect duplicates across the whole import batch.
            const existingIds = new Set((await this.service.getSkills()).map(s => s.id));
            let lastId = '';
            let savedCount = 0;
            for (const item of skills) {
                // Resolve ID: use the one from the file; generate if absent.
                let baseId = item.id ?? `skill-${generateShortUUID()}`;
                // Deduplicate: append -2, -3, ... if the ID already exists.
                if (existingIds.has(baseId)) {
                    let counter = 2;
                    while (existingIds.has(`${baseId}-${counter}`)) counter++;
                    const suffixed = `${baseId}-${counter}`;
                    errors.push(`ID "${baseId}" already exists → renamed to "${suffixed}"`);
                    baseId = suffixed;
                }
                item.id      = baseId;
                existingIds.add(baseId); // prevent duplicates within this import batch
                item.enabled = item.enabled ?? false;
                try {
                    await this.service.saveSkill(item);
                    lastId = item.id;
                    savedCount++;
                } catch (e) {
                    errors.push(`${item.name || item.id}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            this._importing = false;

            if (errors.length > 0) Toast.error(errors.join('\n'));
            if (savedCount > 0) {
                Toast.success(t('skill.toast.imported', { count: savedCount }));
            }
            if (lastId) this.selectedId = lastId;
            await this.render();
        });

        // Cancel also removes the hidden element (guard against already-removed)
        fileInput.addEventListener('cancel', () => {
            if (fileInput.parentNode) document.body.removeChild(fileInput);
        });

        fileInput.click();
    }

    /** Paste-JSON fallback — kept for users who copy from clipboard or CI pipelines. */
    private showPasteImport() {
        const body = `
            <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                ${t('dialog.import.hint')}</p>
            <textarea class="settings-textarea" id="import-json" rows="8"
                style="font-family:monospace;font-size:.8125rem"
                placeholder='[{"name":"My Skill","type":"prompt","instructions":"..."}]'></textarea>`;
        new Modal(t('skill.import.title'), body, {
            confirmText: t('dialog.import.action'),
            onConfirm: async () => {
                const text = (document.getElementById('import-json') as HTMLTextAreaElement)?.value ?? '';
                let arr: LLMSkill[];
                try {
                    // Auto-detect YAML (starts with `---` or a plain key, not `[` or `{`)
                    const looksLikeYaml = text.trimStart().startsWith('---') ||
                        /^[a-zA-Z_][\w]*\s*:/m.test(text.trimStart().slice(0, 120));
                    const data = looksLikeYaml ? yaml.load(text) : JSON.parse(text);
                    arr = Array.isArray(data) ? data as LLMSkill[] : [data as LLMSkill];
                } catch {
                    Toast.error(t('skill.toast.invalidJson'));
                    return false;
                }

                this._importing = true;
                const saveErrors: string[] = [];
                let savedCount = 0;
                for (const item of arr) {
                    item.id      = item.id      ?? `skill-${generateShortUUID()}`;
                    item.enabled = item.enabled ?? false;
                    try {
                        await this.service.saveSkill(item);
                        savedCount++;
                    } catch (e) {
                        saveErrors.push(`${item.name || item.id}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                this._importing = false;

                if (saveErrors.length > 0) Toast.error(saveErrors.join('\n'));
                if (savedCount > 0) {
                    Toast.success(t('skill.toast.imported', { count: savedCount }));
                    this.selectedId = [...arr].reverse().find((s) => s.id)?.id ?? this.selectedId;
                }
                await this.render();
            },
        }).show();
    }

    // ─── Form-only mode helpers ──────────────────────────────────────────────

    private async _renderFormOnly() {
        if (!this.selectedId) {
            this.container.innerHTML = `
                <div style="display:flex;height:100%;align-items:center;justify-content:center;
                            flex-direction:column;gap:.75rem;color:var(--st-text-tertiary)">
                    <span style="font-size:2rem">⚡</span>
                    <span style="font-size:.9375rem">Select a skill to edit</span>
                </div>`;
            return;
        }
        const [skills, mcpServers] = await Promise.all([
            this.service.getSkills(),
            this.service.getMCPServers?.() ?? Promise.resolve([]),
        ]);
        const skill = skills.find((s) => s.id === this.selectedId);
        if (!skill) { this.container.innerHTML = ''; return; }
        this.container.innerHTML = this.renderDetail(skill, mcpServers);
        this.bindEvents(mcpServers); // bindEvents gracefully skips missing sidebar elements
    }

    private async exportAll() {
        const skills = await this.service.getSkills(); // always export fresh data
        this.downloadYaml(skills, 'skills.yaml');
    }

    // ─── Batch actions ───────────────────────────────────────────────────────

    private async batchDelete() {
        const ids = [...this._checkedIds];
        if (ids.length === 0) return;
        Modal.confirm(
            t('dialog.delete.title'),
            `Delete ${ids.length} selected skill${ids.length > 1 ? 's' : ''}?`,
            async () => {
                this._importing = true;
                for (const id of ids) await this.service.deleteSkill(id).catch(() => {});
                this._importing = false;
                this._checkedIds.clear();
                if (ids.includes(this.selectedId ?? '')) this.selectedId = null;
                await this.render();
            },
        );
    }

    private async batchExport() {
        const ids = new Set(this._checkedIds);
        if (ids.size === 0) return;
        const all = await this.service.getSkills();
        const selected = all.filter(s => ids.has(s.id));
        this.downloadYaml(selected, selected.length === 1 ? `${selected[0].id}.yaml` : 'skills-export.yaml');
    }

    private downloadYaml(skills: LLMSkill[], filename: string) {
        const content = yaml.dump(skills, { lineWidth: -1, noRefs: true });
        const blob = new Blob([content], { type: 'text/yaml' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
    }
}
