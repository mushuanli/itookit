export function initSidebarNavigation() {
    const navButtons = document.querySelectorAll('.app-nav-btn');
    const workspaces = document.querySelectorAll('.workspace-view');

    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = (e.currentTarget as HTMLElement).dataset.target;
            if (!targetId) return;

            // 1. 更新按钮状态
            navButtons.forEach(b => b.classList.remove('active'));
            (e.currentTarget as HTMLElement).classList.add('active');

            // 2. 切换视图可见性
            workspaces.forEach(ws => {
                if (ws.id === targetId) {
                    ws.classList.add('active');
                    // 触发 resize 事件以确保编辑器重新计算布局
                    window.dispatchEvent(new Event('resize'));
                } else {
                    ws.classList.remove('active');
                }
            });
        });
    });
}
