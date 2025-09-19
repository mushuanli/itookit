// src/modules/task/index.js

/**
 * Task 模块的初始化函数
 * @param {HTMLElement} container - 主内容容器
 * @param {object} services - 注入的服务对象
 */
export function initialize(container, services) {
    const layoutTemplate = document.getElementById('template-two-pane-layout');
    const viewContentTemplate = document.getElementById('template-view-task');

    if (!layoutTemplate || !viewContentTemplate) {
        console.error("Task module templates not found!");
        container.innerHTML = `<p class="error">Error: Task module templates are missing.</p>`;
        return;
    }

    // 渲染逻辑与 Anki 模块完全相同
    const layoutClone = layoutTemplate.content.cloneNode(true);
    const viewContentClone = viewContentTemplate.content.cloneNode(true);

    const sidebarContainer = layoutClone.querySelector('[data-slot-container="sidebar"]');
    const mainContainer = layoutClone.querySelector('[data-slot-container="main"]');
    
    const sidebarContent = viewContentClone.querySelector('[data-slot-content="sidebar"]');
    const mainContent = viewContentClone.querySelector('[data-slot-content="main"]');

    if (sidebarContainer && sidebarContent) {
        sidebarContainer.appendChild(sidebarContent);
    }
    if (mainContainer && mainContent) {
        mainContainer.appendChild(mainContent);
    }

    container.appendChild(layoutClone);

    console.log("Task Module Initialized and Rendered");
}

/**
 * Task 模块的销毁函数
 */
export function destroy() {
    console.log("Task Module Destroyed");
}
