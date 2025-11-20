/**
 * @file apps/web-app/src/utils/layout.ts
 */
export function initSidebarNavigation() {
    // 1. 获取所有导航按钮和工作区容器
    const navButtons = document.querySelectorAll('.app-nav-btn');
    const workspaces = document.querySelectorAll('.workspace-view');

    if (navButtons.length === 0 || workspaces.length === 0) {
        console.warn('Navigation elements not found.');
        return;
    }

    // 2. 定义切换函数
    const activateWorkspace = (targetId: string) => {
        // 隐藏所有工作区
        workspaces.forEach(ws => {
            if (ws.id === targetId) {
                ws.classList.add('active');
            } else {
                ws.classList.remove('active');
            }
        });

        // 更新按钮状态
        navButtons.forEach(btn => {
            const btnTarget = (btn as HTMLElement).dataset.target;
            if (btnTarget === targetId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    };

    // 3. 绑定事件监听
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // 获取 data-target 属性
            // 注意：使用 currentTarget 确保获取到的是 a 标签，而不是里面的 i 图标
            const targetId = (e.currentTarget as HTMLElement).dataset.target;
            if (targetId) {
                activateWorkspace(targetId);
            }
        });
    });

    // 4. 初始化：确保默认显示第一个（或者 HTML 中带有 active 类的那个）
    // 如果 HTML 中 #prompt-workspace 没有 active 类，这里手动触发一次
    const activeBtn = document.querySelector('.app-nav-btn.active');
    if (activeBtn) {
        const target = (activeBtn as HTMLElement).dataset.target;
        if (target) activateWorkspace(target);
    }
}
