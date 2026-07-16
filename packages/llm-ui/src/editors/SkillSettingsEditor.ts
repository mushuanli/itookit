// @file llm-ui/editors/SkillSettingsEditor.ts
import { BaseSettingsEditor, t } from '@itookit/common';
import type { LLMSkill, SkillType, IAgentManagementService } from '@itookit/common';
import yaml from 'js-yaml';

// Render helpers
import {
    renderEmptyList, renderListItem, renderEmptyState,
    renderMcpToolOptions, renderDetail,
} from './skill/SkillRenderer';

// Import/export/batch operations
import {
    showImport, showPasteImport, exportAll, batchDelete, batchExport,
    type SkillImporterDeps,
} from './skill/SkillImporter';

// CRUD operations
import {
    addNew, saveCurrent, deleteCurrent, testCurrent,
    saveNameOnly, saveIconOnly,
    type SkillOperationsDeps,
} from './skill/SkillOperations';

// ─── SkillSettingsEditor ──────────────────────────────────────────────────────

export class SkillSettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    selectedId: string | null = null;
    /** True while a batch import is in progress — suppresses onChange-triggered renders. */
    _importing = false;
    /** IDs checked for multi-select batch actions. */
    _checkedIds = new Set<string>();
    /**
     * Form-only mode: renders just the detail panel (no sidebar).
     */
    _formOnly = false;

    /** Factory for form-only mode */
    static createFormOnly(
        container: HTMLElement,
        service: IAgentManagementService,
        options?: import('@itookit/common').EditorOptions,
    ): SkillSettingsEditor {
        const editor = new SkillSettingsEditor(container, service, options ?? {});
        editor._formOnly = true;
        if (options?.nodeId) editor.selectedId = options.nodeId;
        return editor;
    }

    // ── IEditor: init override (sets selectedId from YAML content) ──

    async init(container: HTMLElement, content?: string): Promise<void> {
        if (this._formOnly && content?.trim()) {
            try {
                const skill = yaml.load(content) as { id?: string };
                if (skill?.id) this.selectedId = skill.id;
            } catch { /* ignore */ }
        }
        await super.init(container, content);
    }

    // ── IEditor: getText() — returns skill YAML for auto-save ──

    getText(): string {
        if (!this._formOnly || !this.selectedId) return '';
        const type = this.val('type') as SkillType;
        let parameters: Record<string, unknown> | undefined;
        const rawParams = this.val('parameters').trim();
        if (rawParams) { try { parameters = JSON.parse(rawParams); } catch { /* invalid */ } }

        const authVal = this.val('auth-header').trim();
        const rawHdrs = this.val('headers').trim();
        let headers: Record<string, string> | undefined;
        if (rawHdrs) { try { headers = JSON.parse(rawHdrs); } catch { /* invalid */ } }
        if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

        const globs = this.val('globs').split('\n').map(s => s.trim()).filter(Boolean);
        const skill: LLMSkill = {
            id:           this.selectedId,
            name:         this.val('header-name') || this.selectedId,
            icon:         this.val('header-icon') || undefined,
            description:  this.val('description') || '',
            type,
            enabled:      this.chk('enabled'),
            instructions: type === 'prompt' ? (this.val('instructions') || '') : '',
            command:      type === 'shell'  ? (this.val('command')      || undefined) : undefined,
            mcpServerId:  type === 'mcp'    ? (this.val('mcpServerId')  || undefined) : undefined,
            mcpToolName:  type === 'mcp'    ? (this.val('mcpToolName')  || undefined) : undefined,
            endpoint:     type === 'http'   ? (this.val('endpoint')     || undefined) : undefined,
            method:       type === 'http'   ? ((this.val('method') || 'POST') as LLMSkill['method']) : undefined,
            headers:      type === 'http'   ? headers : undefined,
            parameters:   (type !== 'prompt' && type !== 'mcp') ? parameters : undefined,
            triggerStrategy: (this.val('triggerStrategy') || 'reference') as LLMSkill['triggerStrategy'],
            autoLoad:     this.chk('autoLoad'),
            priority:     parseInt(this.val('priority') || '50', 10),
            globs:        globs.length > 0 ? globs : undefined,
            tools:             [],
            triggerPatterns:   [],
            correctionLog: this.val('correctionLog').trim() ? {
                path: this.val('correctionLog').trim(),
                enabled: true,
            } : undefined,
            disableModelInvocation: this.chk('disableModelInvocation') || undefined,
            modifiedAt:   Date.now(),
        };
        return yaml.dump(skill, { lineWidth: -1, noRefs: true });
    }

    // ── build deps for extracted modules ──

    private buildImporterDeps(): SkillImporterDeps {
        const self = this;
        return {
            service: this.service,
            render: () => this.render(),
            get selectedId() { return self.selectedId; },
            set selectedId(id: string | null) { self.selectedId = id; },
            get importing() { return self._importing; },
            set importing(v: boolean) { self._importing = v; },
            get checkedIds() { return self._checkedIds; },
            set checkedIds(ids: Set<string>) { self._checkedIds = ids; },
        };
    }

    private buildOpsDeps(): SkillOperationsDeps {
        const self = this;
        return {
            service: this.service,
            container: this.container,
            render: () => this.render(),
            val: (name) => this.val(name),
            chk: (name) => this.chk(name),
            get selectedId() { return self.selectedId; },
            set selectedId(id: string | null) { self.selectedId = id; },
            syncMetadata: (patch) => this.syncMetadata(patch),
            syncName: (newName) => this.syncName(newName),
            resizeHeaderInput: (input) => this.resizeHeaderInput(input),
        };
    }

    // ── Render ────────────────────────────────────────────────────────────

    async render() {
        if (this._importing) return;

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
            <div class="settings-split${this.selectedId ? ' has-detail' : ''}">
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
                        ${skills.length === 0 ? renderEmptyList() : skills.map(s => renderListItem(s, this.selectedId, this._checkedIds)).join('')}
                    </div>
                </div>

                <div class="settings-split__content">
                    <button class="settings-mobile-back" data-action="mobile-back">&#8592; Skills</button>
                    ${selected ? renderDetail(selected, mcpServers, (params) => this.renderEntityHeader(params)) : renderEmptyState()}
                </div>
            </div>`;

        this.bindEvents(mcpServers);
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private bindEvents(mcpServers: import('@itookit/common').MCPServer[]) {
        this.clearListeners();
        const ops = this.buildOpsDeps();
        const imp = this.buildImporterDeps();

        // ── Sidebar: checkbox = multi-select, click = single-select, dblclick = rename ──
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'change', (e) => {
                const cb = (e.target as HTMLElement).closest('[data-check-id]') as HTMLInputElement | null;
                if (!cb) return;
                const id = cb.dataset.checkId!;
                if (cb.checked) this._checkedIds.add(id);
                else this._checkedIds.delete(id);
                this.render();
            });
            this.addEventListener(list, 'click', (e) => {
                if ((e.target as HTMLElement).closest('.settings-inline-rename')) return;
                if ((e.target as HTMLElement).closest('[data-check-id]')) return;
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
            this.addEventListener(list, 'dblclick', (e) => {
                const titleEl = (e.target as HTMLElement).closest('[data-name-for]') as HTMLElement | null;
                if (titleEl) this._startSkillInlineRename(titleEl, titleEl.dataset.nameFor!);
            });
        }

        // ── Mobile: back button clears selection ─────────────────────────────
        this.bindAction('mobile-back', () => { this.selectedId = null; this.render(); });

        // ── Batch actions ────────────────────────────────────────────────────
        this.bindAction('batch-clear',  () => { this._checkedIds.clear(); this.render(); });
        this.bindAction('batch-delete', () => batchDelete(imp));
        this.bindAction('batch-export', () => batchExport(imp));

        // ── Header icon + name: auto-save on blur ─────────────────────────────
        this.bindEntityHeaderEvents({
            onIconSave: (icon) => saveIconOnly(ops, icon),
            onNameSave: (name) => saveNameOnly(ops, name),
        });

        // ── triggerStrategy: show/hide disableModelInvocation ─────────────
        const triggerSel = this.container.querySelector<HTMLSelectElement>('#trigger-strategy-select');
        const disableRow = this.container.querySelector<HTMLElement>('#disable-invocation-row');
        if (triggerSel && disableRow) {
            this.addEventListener(triggerSel, 'change', () => {
                disableRow.style.display = triggerSel.value === 'action' ? '' : 'none';
            });
        }

        // ── Action buttons ─────────────────────────────────────────────────────
        this.bindAction('add',          () => addNew(ops));
        this.bindAction('import',       () => showImport(imp));
        this.bindAction('import-paste', () => showPasteImport(imp));
        this.bindAction('export',       () => exportAll(imp));
        this.bindAction('save',   () => saveCurrent(ops));
        this.bindAction('delete', () => deleteCurrent(ops));
        this.bindAction('test',   () => testCurrent(ops));

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
                    renderMcpToolOptions(serverId, undefined, mcpServers);
            });
        }
    }

    private _startSkillInlineRename(titleEl: HTMLElement, skillId: string): void {
        this.startInlineRename(
            titleEl,
            async (newName) => {
                const skills = await this.service.getSkills();
                const skill  = skills.find(s => s.id === skillId);
                if (!skill) return;
                await this.service.saveSkill({ ...skill, name: newName, modifiedAt: Date.now() });
            },
            (newName) => {
                if (skillId !== this.selectedId) return;
                const hdr = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
                const frm = this.container.querySelector<HTMLInputElement>('[name="name"]');
                if (hdr) { hdr.value = newName; this.resizeHeaderInput(hdr); }
                if (frm) frm.value = newName;
            },
        );
    }

    /** Bind ALL elements with `data-action="<action>"` */
    private bindAction(action: string, handler: () => void) {
        this.container.querySelectorAll(`[data-action="${action}"]`).forEach(el =>
            this.addEventListener(el, 'click', handler)
        );
    }

    val(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    }
    chk(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.checked ?? false;
    }

    // ─── Form-only mode ────────────────────────────────────────────────────

    private async _renderFormOnly() {
        const [skills, mcpServers] = await Promise.all([
            this.service.getSkills(),
            this.service.getMCPServers?.() ?? Promise.resolve([]),
        ]);

        const skill = this.selectedId ? skills.find((s) => s.id === this.selectedId) : null;

        if (!skill) {
            this.container.innerHTML = renderEmptyState();
            this.bindEvents(mcpServers);
            return;
        }

        this.container.innerHTML = renderDetail(skill, mcpServers, (params) => this.renderEntityHeader(params));
        this.bindEvents(mcpServers);
    }
}
