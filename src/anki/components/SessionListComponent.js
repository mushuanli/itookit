// src/anki/components/SessionListComponent.js

import { escapeHTML,slugify } from '../../common/utils.js';

export class SessionListComponent {
    constructor(store) {
        this.store = store;
        this.listElement = document.getElementById('anki_sessionList');
        this.headerElement = document.querySelector('.session-header');
        this.breadcrumbsElement = document.getElementById('anki_currentFolderContainer');
        // [修正1] 获取 emptySession 元素的引用
        this.emptySessionElement = document.getElementById('anki_emptySession');
        
        // 订阅所有与列表和导航相关的状态
        this.unsubscribe = store.subscribe(
            this.handleStateChange.bind(this),
            [
                'sessions', 
                'folders', 
                'currentSessionId', 
                'currentFolderId', 
                'selectedItemIds', 
                'folderStack', 
                'fileSubsessions',
                'expandedHeadingIds' // <-- 添加新状态
            ]
        );
        this.setupEventListeners();
    }
  
    setupEventListeners() {
        // 使用事件委托处理整个列表的点击
        this.listElement.addEventListener('click', (e) => {
            // [NEW] 处理子标题点击
            const headingItem = e.target.closest('.subsession-item');
            if (headingItem) {
                e.stopPropagation();
                
                // +++ 关键修改：同时获取 headingId 和 fileId +++
                const targetId = headingItem.dataset.targetId;
                const fileId = headingItem.dataset.fileId; // <--- 新增

                if (targetId && fileId) {
                    if (headingItem.classList.contains('h1') && headingItem.classList.contains('expandable')) {
                        this.store.toggleHeadingExpansion(headingItem.dataset.headingId);
                    } else {
                        // +++ 关键修改：将 fileId 传递给 action +++
                        this.store.navigateToHeading(targetId, fileId);
                    }
                }
                return;
            }

            const item = e.target.closest('.session-item');
            if (!item) return;
            const { id, type } = item.dataset;

            // 处理复选框点击
            if (e.target.matches('.select-checkbox')) {
                this.store.toggleItemSelection(id, e.shiftKey);
                return;
            }
            // 处理操作按钮
            if (e.target.closest('.actions')) {
                // 可以在此处理重命名、删除单个项目等
                return;
            }
            // 处理项目导航
            if (type === 'file') {
                this.store.navigateToFile(id);
                // 立即更新标题（乐观更新）
                const session = this.store.getState().sessions.find(s => s.id === id);
                if (session) {
                    document.title = `Anki - ${session.name}`;
                }
            } else if (type === 'folder') {
                this.store.goToFolder(id);
                document.title = '智能学习套件'; // 进入文件夹时重置标题
            }
        });

        // 处理面包屑导航点击
        this.breadcrumbsElement.addEventListener('click', (e) => {
            const link = e.target.closest('[data-folder-id]');
            if (link) {
                e.preventDefault();
                const folderId = link.dataset.folderId;
                if (folderId === 'root') this.store.goToRoot();
                else this.store.goToFolder(folderId);
            }
        });

        // 处理头部按钮点击
        this.headerElement.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            switch(button.id) {
                case 'anki_newFileBtn': this.store.createFile(); break;
                case 'anki_newFolderBtn': this.store.createFolder(); break;
                case 'anki_deleteSelectedBtn': this.store.deleteSelectedItems(); break;
                case 'anki_moveSelectedBtn': this.store.showMoveModal(); break;
                case 'anki_openFileBtn': document.getElementById('anki_fileInput').click(); break;
            }
        });
        
        // 处理全选复选框
        const selectAllCheckbox = document.getElementById('anki_selectAllCheckbox');
        selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) this.store.selectAllItems();
            else this.store.deselectAllItems();
        });

        // 处理文件导入
        const fileInput = document.getElementById('anki_fileInput');
        fileInput.addEventListener('change', (e) => {
            this.store.importFiles(e.target.files);
            e.target.value = ''; // 清空以便再次选择
        });
    }
  
    handleStateChange(newState) {
        this.render(newState);
    }
  
    render(state) {
        this.renderBreadcrumbs(state);
        
        const itemsInCurrentFolder = [
            ...state.folders.filter(f => f.folderId === state.currentFolderId),
            ...state.sessions.filter(s => s.folderId === state.currentFolderId)
        ].sort((a, b) => {
            if (a.type === 'folder' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'folder') return 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        if (itemsInCurrentFolder.length === 0) {
            this.listElement.innerHTML = '';
            if (state.currentFolderId === null) {
                // 场景一：根目录为空
                this.emptySessionElement.style.display = 'block'; // 显示大图标提示
            } else {
                // 场景二：子目录为空
                this.listElement.innerHTML = '<li class="empty-folder">此目录为空</li>';
                this.emptySessionElement.style.display = 'none'; // 隐藏大图标提示
            }
        } else {
            // 场景三：目录不为空
            this.emptySessionElement.style.display = 'none'; // 隐藏大图标提示
            const fragment = document.createDocumentFragment();
            itemsInCurrentFolder.forEach(item => {
                const li = this.createItemElement(item, state);
                fragment.appendChild(li);
            });
            this.listElement.innerHTML = '';
            this.listElement.appendChild(fragment);
        }
        
        this.updateSelectAllCheckbox(itemsInCurrentFolder, state.selectedItemIds);
    }

    /**
     * [重构] 创建一个辅助方法来生成标题列表的HTML
     * @param {Array} headings - 从 state.fileSubsessions 获取的标题数组
     * @returns {string} - 代表标题列表的HTML字符串
     */
    _createHeadingsListHtml(headings, fileId, state) {
        if (!headings || headings.length === 0) return '';
    
        const { expandedHeadingIds } = state;
        let html = '<ul class="subsession-list">';
    
        headings.forEach(h1 => {
            const targetId = slugify(h1.text);
            const hasChildren = h1.children && h1.children.length > 0;
            const isExpanded = expandedHeadingIds.has(h1.id);
    
            const h1Classes = `subsession-item h1 ${hasChildren ? 'expandable' : ''} ${isExpanded ? 'expanded' : ''}`;
            const icon = hasChildren ? '<i class="fas fa-chevron-right heading-toggle-icon"></i>' : '';
    
            html += `<li class="${h1Classes}" data-heading-id="${h1.id}" data-target-id="${targetId}" data-file-id="${fileId}">
                        ${icon}
                        <span class="heading-level">H1</span>
                        <span class="heading-text">${escapeHTML(h1.text)}</span>
                     </li>`;
    
            // [MODIFIED] 只有在 H1 展开时才渲染 H2 列表
            if (hasChildren && isExpanded) {
                html += '<ul class="subsession-list-h2">';
                h1.children.forEach(h2 => {
                    const h2TargetId = slugify(h2.text);
                    html += `<li class="subsession-item h2" data-heading-id="${h2.id}" data-target-id="${h2TargetId}" data-file-id="${fileId}">
                                <span class="heading-level">H2</span>
                                <span class="heading-text">${escapeHTML(h2.text)}</span>
                             </li>`;
                });
                html += '</ul>';
            }
        });
        html += '</ul>';
        return html;
    }

    /**
     * [重构] 修改此方法以渲染子标题
     */
    createItemElement(item, state) {
        const li = document.createElement('li');
        li.className = `session-item ${item.type}`;
        li.dataset.id = item.id;
        li.dataset.type = item.type;
        if (item.id === state.currentSessionId) li.classList.add('active');
        
        const isSelected = state.selectedItemIds.has(item.id);
        const iconClass = item.type === 'folder' 
            ? 'fa-folder folder-icon' 
            : 'fa-file-alt file-icon';
        
        // [新增] 检查是否存在子会话（标题）并生成它们的HTML
        let subsessionHtml = '';
        // [MODIFIED] 仅为当前活动文档生成标题列表
        if (item.type === 'file' && item.id === state.currentSessionId && state.fileSubsessions && state.fileSubsessions[item.id]) {
            subsessionHtml = this._createHeadingsListHtml(state.fileSubsessions[item.id], item.id, state);
        }

        // --- 使用已声明的变量构建 HTML ---
        li.innerHTML = `
            <div class="name-container">
                <input type="checkbox" class="select-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''}>
                <span class="name"><i class="fas ${iconClass}"></i>${escapeHTML(item.name)}</span>
            </div>
            <div class="actions">
                 <i class="fas fa-pencil-alt edit-btn" title="重命名"></i>
            </div>
            ${subsessionHtml} 
        `; // <-- 将标题列表HTML添加到这里
        
        return li;
    }

    renderBreadcrumbs(state) {
        let html = `<a href="#" data-folder-id="root"><i class="fas fa-folder-open"></i> 根目录</a>`;
        const folderMap = new Map(state.folders.map(f => [f.id, f.name]));

        state.folderStack.forEach(folderId => {
            html += ` / <a href="#" data-folder-id="${folderId}">${escapeHTML(folderMap.get(folderId) || '...')}</a>`;
        });

        if (state.currentFolderId) {
            html += ` / <span>${escapeHTML(folderMap.get(state.currentFolderId) || '...')}</span>`;
        }
        this.breadcrumbsElement.innerHTML = html;
    }
    
    updateSelectAllCheckbox(allItems, selectedIds) {
        const checkbox = document.getElementById('anki_selectAllCheckbox');
        if (allItems.length === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            return;
        }
        const selectedCount = allItems.filter(item => selectedIds.has(item.id)).length;
        checkbox.checked = selectedCount === allItems.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < allItems.length;
    }

    destroy() {
        this.unsubscribe();
    }
}