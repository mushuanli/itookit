// src/modules/settings/index.js

/**
 * Settings 模块的初始化函数
 * @param {HTMLElement} container - 主内容容器
 * @param {object} services - 注入的服务对象
 */
export function initialize(container, services) {
    const viewTemplate = document.getElementById('template-view-settings');

    if (!viewTemplate) {
        console.error("Settings module template not found!");
        container.innerHTML = `<p class="error">Error: Settings module template is missing.</p>`;
        return;
    }

    // 直接克隆并挂载 Settings 视图模板
    const viewClone = viewTemplate.content.cloneNode(true);
    container.appendChild(viewClone);

    console.log("Settings Module Initialized and Rendered");

    // Settings 模块通常有更复杂的内部逻辑来动态渲染右侧面板，
    // 这里可以进一步调用其 Controller 来处理
    // const controller = new SettingsController(container, services);
    // controller.renderInitialContent(); 
}

/**
 * Settings 模块的销毁函数
 */
export function destroy() {
    console.log("Settings Module Destroyed");
}
