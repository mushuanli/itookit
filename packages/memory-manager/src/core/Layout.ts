export class Layout {
    public sidebarContainer: HTMLElement;
    public editorContainer: HTMLElement;

    constructor(private container: HTMLElement) {
        this.container.innerHTML = '';
        this.container.classList.add('mm-layout');

        this.sidebarContainer = document.createElement('div');
        this.sidebarContainer.className = 'mm-sidebar';
        
        this.editorContainer = document.createElement('div');
        this.editorContainer.className = 'mm-editor-area';

        this.container.appendChild(this.sidebarContainer);
        this.container.appendChild(this.editorContainer);
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
        this.container.classList.remove('mm-layout');
    }
}