// @file common/components/BaseSettingsEditor.ts

import { IEditor, CollapseExpandResult, EditorOptions, UnifiedSearchResult, Heading, EditorEvent, EditorEventCallback } from '../interfaces/IEditor';
import { t } from '../i18n';

/**
 * 定义宿主能力接口 (与 MemoryManager 的 EditorHostContext 保持结构兼容)
 */
export interface IEditorHostContext {
    toggleSidebar: (collapsed?: boolean) => void;
    saveContent: (nodeId: string, content: string) => Promise<void>;
}

/**
 * 设置类编辑器的基类
 * @template TService 服务层的类型
 */
export abstract class BaseSettingsEditor<TService> implements IEditor {
    protected listeners: Array<{ el: Element, type: string, handler: EventListener }> = [];
    protected container!: HTMLElement;

    // [新增] 宿主能力引用
    protected hostContext?: IEditorHostContext;

    constructor(
        container: HTMLElement,
        protected service: TService,
        protected options: EditorOptions
    ) {
        this.container = container;
    }

    async init(container: HTMLElement, _initialContent?: string) {
        this.container = container;
        this.container.classList.add('settings-root');

        // [新增] 消费宿主能力
        // 策略层(Strategy)会将 hostContext 注入到 options 中
        if (this.options.hostContext) {
            this.hostContext = this.options.hostContext as IEditorHostContext;
        }

        // Service 变更订阅
        if (this.service && typeof (this.service as any).onChange === 'function') {
            const unsubscribe = (this.service as any).onChange(() => this.render());

            // Hook destroy
            const originalDestroy = this.destroy;
            this.destroy = async () => {
                unsubscribe();
                await originalDestroy.call(this);
            };
        }

        await this.render();
    }

    // [新增] 辅助方法：切换侧边栏
    protected toggleSidebar() {
        this.hostContext?.toggleSidebar();
    }

    /**
     * Sync node metadata (icon, description, etc.) to the engine so vfs-ui
     * refreshes its list display. Safe to call without engine — no-ops silently.
     */
    protected async syncMetadata(changes: Record<string, unknown>): Promise<void> {
        const engine = this.options.sessionEngine;
        const nodeId = this.options.nodeId;
        if (!engine || !nodeId) return;
        await engine.updateMetadata(nodeId, changes);
    }

    /**
     * Sync node name to the engine so vfs-ui refreshes its list display.
     * Safe to call without engine — no-ops silently.
     */
    protected async syncName(newName: string): Promise<void> {
        const engine = this.options.sessionEngine;
        const nodeId = this.options.nodeId;
        if (!engine || !nodeId || !newName) return;
        await engine.rename(nodeId, newName);
    }

    abstract render(): void | Promise<void>;

    focus() { }

    protected addEventListener(el: Element | null, type: string, handler: EventListener) {
        if (el) {
            el.addEventListener(type, handler);
            this.listeners.push({ el, type, handler });
        }
    }

    protected clearListeners() {
        this.listeners.forEach(l => l.el.removeEventListener(l.type, l.handler));
        this.listeners = [];
    }

    // --- IEditor Stubs ---
    async destroy() {
        this.clearListeners();
        this.container.innerHTML = '';
    }

    getText() { return ''; }
    setText(_text: string) { }

    getMode(): 'edit' | 'render' { return 'render'; }
    async switchToMode(_mode: 'edit' | 'render') { }
    setTitle(_title: string) { }
    setReadOnly(_readOnly: boolean) { }
    isDirty() { return false; }
    setDirty(_dirty: boolean) { }

    get commands() { return {}; }
    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText(): Promise<string> { return ''; }
    async getSummary(): Promise<string | null> { return null; }
    async navigateTo(_target: { elementId: string }) { }
    async search(_query: string): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch(_result: UnifiedSearchResult) { }
    clearSearch() { }

    async collapseBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: true };
    }

    async expandBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: false };
    }

    async toggleBlocks(): Promise<CollapseExpandResult> {
        return this.collapseBlocks();
    }

    async pruneAssets(): Promise<number | null> {
        return null; // 设置页面通常没有附件需要清理
    }

    on(_eventName: EditorEvent, _callback: EditorEventCallback) { return () => { }; }

    // ── Entity header helpers (shared by Skill, MCP, and future entity editors) ──

    /**
     * Renders the standard entity detail-panel header:
     *   [icon] [name input] [badges]          [actions]
     *          [subtitle]
     *
     * Pass `editableIcon: true` to render an editable <input> for the icon;
     * otherwise a static <span> is rendered.
     */
    protected renderEntityHeader(opts: {
        icon: string;
        fallbackIcon: string;
        editableIcon?: boolean;
        name: string;
        namePlaceholder?: string;
        badges?: string;
        subtitle?: string;
        actions?: string;
    }): string {
        const iconEl = opts.editableIcon
            ? `<input name="header-icon" value="${opts.icon}" placeholder="${opts.fallbackIcon}"
                   title="${t('tooltip.clickEditIcon')}"
                   style="font-size:2rem;width:2.75rem;height:2.75rem;text-align:center;
                          border:2px solid transparent;border-radius:8px;background:transparent;
                          cursor:pointer;outline:none;padding:0;font-family:inherit;flex-shrink:0;
                          transition:border-color .15s"
                   maxlength="2">`
            : `<span style="font-size:2.25rem;flex-shrink:0;line-height:1">${opts.icon || opts.fallbackIcon}</span>`;

        return `
            <div style="padding:1.25rem 1.75rem;border-bottom:1px solid var(--st-border-color);
                        display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:1rem;min-width:0">
                    ${iconEl}
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                            <input name="header-name" value="${opts.name}"
                                placeholder="${opts.namePlaceholder ?? ''}"
                                style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary);
                                       background:transparent;border:0;border-bottom:2px solid transparent;
                                       outline:none;padding:0 0 1px;font-family:inherit;
                                       width:auto;min-width:60px;max-width:280px;cursor:text;
                                       transition:border-color .15s"
                                title="${t('tooltip.clickEditName')}">
                            ${opts.badges ?? ''}
                        </div>
                        ${opts.subtitle ? `
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);margin-top:.125rem">
                            ${opts.subtitle}
                        </div>` : ''}
                    </div>
                </div>
                ${opts.actions ? `<div style="display:flex;gap:.5rem;flex-shrink:0">${opts.actions}</div>` : ''}
            </div>`;
    }

    /**
     * Binds focus/blur/keydown on [name="header-name"] and optionally [name="header-icon"].
     * Must be called after every render that includes renderEntityHeader().
     *
     * @param onNameSave - Called on blur with the trimmed new name (skip if falsy or unchanged).
     * @param onIconSave - Called on blur with the trimmed new icon value (only when editableIcon).
     * @param mirrorNameSelector - CSS selector of a secondary input to keep in sync with header-name.
     */
    protected bindEntityHeaderEvents(opts: {
        onNameSave?: (newName: string) => Promise<void>;
        onIconSave?: (newIcon: string) => Promise<void>;
        mirrorNameSelector?: string;
    } = {}): void {
        const nameInput = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
        if (nameInput) {
            this.addEventListener(nameInput, 'focus', () => {
                nameInput.style.borderBottomColor = 'var(--st-primary, #6366f1)';
            });
            this.addEventListener(nameInput, 'blur', async () => {
                nameInput.style.borderBottomColor = 'transparent';
                if (opts.onNameSave) await opts.onNameSave(nameInput.value.trim());
            });
            this.addEventListener(nameInput, 'keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter')  nameInput.blur();
                if ((e as KeyboardEvent).key === 'Escape') nameInput.blur();
            });
            if (opts.mirrorNameSelector) {
                const mirror = this.container.querySelector<HTMLInputElement>(opts.mirrorNameSelector);
                if (mirror) {
                    this.addEventListener(nameInput, 'input', () => {
                        mirror.value = nameInput.value;
                        this.resizeHeaderInput(nameInput);
                    });
                    this.addEventListener(mirror, 'input', () => {
                        nameInput.value = mirror.value;
                        this.resizeHeaderInput(nameInput);
                    });
                }
            }
            this.resizeHeaderInput(nameInput);
        }

        const iconInput = this.container.querySelector<HTMLInputElement>('[name="header-icon"]');
        if (iconInput && opts.onIconSave) {
            this.addEventListener(iconInput, 'focus', () => {
                iconInput.style.borderColor = 'var(--st-primary, #6366f1)';
                iconInput.select();
            });
            this.addEventListener(iconInput, 'blur', async () => {
                iconInput.style.borderColor = 'transparent';
                await opts.onIconSave!(iconInput.value.trim());
            });
            this.addEventListener(iconInput, 'keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter')  iconInput.blur();
                if ((e as KeyboardEvent).key === 'Escape') iconInput.blur();
            });
        }
    }

    /** Auto-sizes an input to its content width (max 280px). */
    protected resizeHeaderInput(input: HTMLInputElement): void {
        input.style.width = '4px';
        input.style.width = `${Math.min(input.scrollWidth + 4, 280)}px`;
    }

    /**
     * Replaces a sidebar title element with an inline rename <input>.
     * Commits on blur/Enter; cancels on Escape.
     * Uses the shared CSS class `settings-inline-rename` — list click handlers
     * should guard against this class to prevent inadvertent item selection.
     *
     * @param titleEl  - The element showing the current name (will be cleared).
     * @param onCommit - Async save callback; receives the confirmed new name.
     * @param onAfterCommit - Optional sync DOM patch after a successful commit.
     */
    protected startInlineRename(
        titleEl: HTMLElement,
        onCommit: (newName: string) => Promise<void>,
        onAfterCommit?: (newName: string) => void,
    ): void {
        if (titleEl.querySelector('input')) return;
        const original = titleEl.textContent?.trim() ?? '';

        const input = document.createElement('input');
        input.value = original;
        input.className = 'settings-inline-rename';
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
            titleEl.textContent = newName;
            if (newName !== original) {
                await onCommit(newName);
                onAfterCommit?.(newName);
            }
        };

        input.addEventListener('blur', commit as EventListener, { once: true });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { input.blur(); }
            if (e.key === 'Escape') {
                input.removeEventListener('blur', commit as EventListener);
                committed = true;
                titleEl.textContent = original;
            }
        });
    }

}
