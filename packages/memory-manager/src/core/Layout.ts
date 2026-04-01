// @file memory-manager/core/Layout.ts
export class Layout {
    public sidebarContainer: HTMLElement;
    public editorContainer: HTMLElement;
    private layoutDiv: HTMLElement;

    constructor(private container: HTMLElement) {
        this.container.innerHTML = '';

        // Use an inner wrapper so mm-layout's display:flex is never overridden
        // by classes on the outer container (e.g. workspace-view.active sets display:block).
        this.layoutDiv = document.createElement('div');
        this.layoutDiv.className = 'mm-layout';

        this.sidebarContainer = document.createElement('div');
        this.sidebarContainer.className = 'mm-sidebar';

        this.editorContainer = document.createElement('div');
        this.editorContainer.className = 'mm-editor-area';

        this.layoutDiv.appendChild(this.sidebarContainer);
        this.layoutDiv.appendChild(this.editorContainer);
        this.container.appendChild(this.layoutDiv);
    }

    public toggleSidebar(isCollapsed: boolean) {
        if (isCollapsed) {
            this.sidebarContainer.classList.add('is-collapsed');
        } else {
            this.sidebarContainer.classList.remove('is-collapsed');
        }

        // 触发 resize 事件，以便编辑器（如 CodeMirror）能重新计算布局
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 310); // 略大于 CSS transition 时间
    }

    public destroy() {
        this.container.innerHTML = '';
    }
}