// @mdx/editor/mode-manager.ts
/**
 * 模式管理器
 * 职责：编辑/渲染模式切换 + 容器管理 + 流式渲染防抖
 */
export class ModeManager {
    private currentMode: 'edit' | 'render';
    private editContainer: HTMLElement | null = null;
    private renderContainer: HTMLElement | null = null;
    private renderDebounceTimer: number | null = null;
    private pendingResolvers: Array<() => void> = [];

    constructor(initialMode: 'edit' | 'render') {
        this.currentMode = initialMode;
    }

    getMode(): 'edit' | 'render' { return this.currentMode; }
    getEditContainer(): HTMLElement | null { return this.editContainer; }
    getRenderContainer(): HTMLElement | null { return this.renderContainer; }

    createContainers(parent: HTMLElement): void {
        const fragment = document.createDocumentFragment();

        this.editContainer = document.createElement('div');
        this.editContainer.className = 'mdx-editor-container__edit-mode';
        fragment.appendChild(this.editContainer);

        this.renderContainer = document.createElement('div');
        this.renderContainer.className = 'mdx-editor-container__render-mode';
        this.renderContainer.tabIndex = -1;
        fragment.appendChild(this.renderContainer);

        parent.appendChild(fragment);
    }

    async init(
        rootContainer: HTMLElement,
        renderFn: () => Promise<void>
    ): Promise<void> {
        const isEdit = this.currentMode === 'edit';
        this.applyModeClasses(rootContainer, isEdit);
        this.applyContainerVisibility(isEdit);

        if (!isEdit) {
            await renderFn();
        }
    }

    async switchTo(
        mode: 'edit' | 'render',
        rootContainer: HTMLElement,
        renderFn: () => Promise<void>
    ): Promise<void> {
        this.currentMode = mode;
        const isEdit = mode === 'edit';
        this.applyModeClasses(rootContainer, isEdit);
        this.applyContainerVisibility(isEdit);

        if (!isEdit) {
            await renderFn();
        }
    }

    /**
     * 流式渲染防抖：合并高频调用，16ms 内只执行一次渲染
     */
    async debouncedRender(renderFn: () => Promise<void>): Promise<void> {
        return new Promise((resolve) => {
            this.pendingResolvers.push(resolve);

            if (!this.renderDebounceTimer) {
                this.renderDebounceTimer = window.setTimeout(async () => {
                    this.renderDebounceTimer = null;
                    try { await renderFn(); }
                    catch (e) { console.error('[ModeManager] Render failed:', e); }

                    const resolvers = this.pendingResolvers;
                    this.pendingResolvers = [];
                    resolvers.forEach(r => r());
                }, 16);
            }
        });
    }

    private applyModeClasses(root: HTMLElement, isEdit: boolean): void {
        root.classList.toggle('is-edit-mode', isEdit);
        root.classList.toggle('is-render-mode', !isEdit);
    }

    private applyContainerVisibility(isEdit: boolean): void {
        if (this.editContainer) this.editContainer.style.display = isEdit ? 'flex' : 'none';
        if (this.renderContainer) this.renderContainer.style.display = isEdit ? 'none' : 'block';
    }

    destroy(): void {
        if (this.renderDebounceTimer) {
            clearTimeout(this.renderDebounceTimer);
            this.renderDebounceTimer = null;
        }
        this.pendingResolvers.forEach(r => r());
        this.pendingResolvers = [];
        this.editContainer = null;
        this.renderContainer = null;
    }
}
