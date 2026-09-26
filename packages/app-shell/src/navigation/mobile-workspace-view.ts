import { t } from '@itookit/common';

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
        if (sidebar.classList.contains('project-workbench--family')) sidebar.querySelector<HTMLButtonElement>('.vfs-columns__back')?.click();
        layout.dataset.mobileView = 'list';
    };
    const showDetail = (event: Event) => {
        if ((event.target as Element).closest('.vfs-node-item__content') || (hasEditor() && (event.target as Element).closest('.vfs-directory-item__header[aria-pressed]'))) layout.dataset.mobileView = 'detail';
    };
    back.addEventListener('click', showList);
    sidebar.addEventListener('click', showDetail);
    sync();
    return () => { observer.disconnect(); back.removeEventListener('click', showList); sidebar.removeEventListener('click', showDetail); };
}
