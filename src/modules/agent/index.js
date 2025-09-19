// src/modules/agent/index.js

/**
 * Agent 模块的初始化函数
 * @param {HTMLElement} container - 主内容容器
 * @param {object} services - 注入的服务对象
 */
export function initialize(container, services) {
    const viewTemplate = document.getElementById('template-view-agent');

    if (!viewTemplate) {
        console.error("Agent module template not found!");
        container.innerHTML = `<p class="error">Error: Agent module template is missing.</p>`;
        return;
    }

    // 直接克隆并挂载 Agent 视图模板
    const viewClone = viewTemplate.content.cloneNode(true);
    container.appendChild(viewClone);

    console.log("Agent Module Initialized and Rendered");
}

/**
 * Agent 模块的销毁函数
 */
export function destroy() {
    console.log("Agent Module Destroyed");
}
