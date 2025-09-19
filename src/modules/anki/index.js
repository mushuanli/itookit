// src/modules/anki/index.js

// 理想情况下，Controller 和 View 会被导入并实例化，
// 但为了简单地让界面显示，我们暂时只关注渲染逻辑。
// import AnkiController from './AnkiController.js';

/**
 * Anki 模块的初始化函数
 * @param {HTMLElement} container - 主内容容器，模块视图将被挂载到这里
 * @param {object} services - 注入的服务对象 (db, renderer, eventBus 等)
 */
export function initialize(container, services) {
    // 获取布局模板和 Anki 视图的内容模板
    const layoutTemplate = document.getElementById('template-two-pane-layout');
    const viewContentTemplate = document.getElementById('template-view-anki');

    if (!layoutTemplate || !viewContentTemplate) {
        console.error("Anki module templates not found!");
        container.innerHTML = `<p class="error">Error: Anki module templates are missing.</p>`;
        return;
    }

    // 1. 克隆布局模板的 DOM 结构
    const layoutClone = layoutTemplate.content.cloneNode(true);
    
    // 2. 克隆 Anki 视图内容的 DOM 结构
    const viewContentClone = viewContentTemplate.content.cloneNode(true);

    // 3. 将视图内容填充到布局的指定“插槽”(slot)中
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

    // 4. 将最终组合好的视图挂载到主容器
    container.appendChild(layoutClone);

    console.log("Anki Module Initialized and Rendered");
    
    // 在这里，我们可以实例化控制器来处理业务逻辑和事件绑定
    // const controller = new AnkiController(container, services);
}

/**
 * Anki 模块的销毁函数
 */
export function destroy() {
    // 在这里添加清理逻辑，例如移除事件监听器
    // controller.destroy();
    console.log("Anki Module Destroyed");
}