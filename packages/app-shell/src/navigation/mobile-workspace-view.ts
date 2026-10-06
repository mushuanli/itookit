import { t } from '@itookit/common';
import { VFS_DOM_EVENTS } from '@itookit/vfs-ui';

/** Keep list and editor as separate mobile screens within one workspace. */
export function setupMobileWorkspaceView(layout: HTMLElement, sidebar: HTMLElement, editor: HTMLElement): () => void {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mm-mobile-back';
    back.textContent = `← ${t('workspace.mobile.backToList')}`;
    back.setAttribute('aria-label', t('workspace.mobile.backToList'));
    layout.appendChild(back);
    const hasEditor = () => [...editor.children].some(child =>
        !child.classList.contains('mm-placeholder') && !child.classList.contains('editor-placeholder'));
    const sync = () => { layout.dataset.mobileView = hasEditor() ? 'detail' : 'list'; };
    const observer = new MutationObserver(sync);
    observer.observe(editor, { childList: true });
    const showList = () => {
        layout.dataset.mobileView = 'list';
    };
    const showDetail = () => { layout.dataset.mobileView = 'detail'; };
    back.addEventListener('click', showList);
    sidebar.addEventListener(VFS_DOM_EVENTS.resourceActivated, showDetail);
    sync();
    return () => { observer.disconnect(); back.removeEventListener('click', showList); sidebar.removeEventListener(VFS_DOM_EVENTS.resourceActivated, showDetail); };
}
