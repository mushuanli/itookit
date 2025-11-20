/**
 * @file apps/web-app/src/utils/layout.ts
 */

// 定义回调类型
type OnTabChangeCallback = (targetId: string) => void;

export function initSidebarNavigation(onTabChange?: OnTabChangeCallback) {
    const navButtons = document.querySelectorAll('.app-nav-btn');
    const workspaces = document.querySelectorAll('.workspace-view');

    if (navButtons.length === 0 || workspaces.length === 0) return;

    const activateWorkspace = (targetId: string) => {
        // 1. UI 切换 (纯视觉)
        workspaces.forEach(ws => {
            if (ws.id === targetId) ws.classList.add('active');
            else ws.classList.remove('active');
        });

        navButtons.forEach(btn => {
            const btnTarget = (btn as HTMLElement).dataset.target;
            if (btnTarget === targetId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        // 2. 触发回调，通知业务逻辑层加载数据
        if (onTabChange) {
            onTabChange(targetId);
        }
    };

    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = (e.currentTarget as HTMLElement).dataset.target;
            if (targetId) activateWorkspace(targetId);
        });
    });

    // 初始化默认激活的 Tab
    const activeBtn = document.querySelector('.app-nav-btn.active');
    if (activeBtn) {
        const target = (activeBtn as HTMLElement).dataset.target;
        if (target) activateWorkspace(target);
    }
}
