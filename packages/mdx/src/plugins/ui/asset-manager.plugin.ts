/**
 * @file mdx/plugins/ui/asset-manager.plugin.ts
 * @desc 提供可视化的附件管理界面，允许用户预览、下载和清理未引用的附件。
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';
import { Toast, type ISessionEngine, type EngineNode } from '@itookit/common';

// 如果你的环境支持 CSS import (如 Vite/Webpack)，请取消注释下面这行
// import '../../styles/asset-manager.css';

interface AssetDisplayItem {
    node: EngineNode;
    isUsed: boolean;
    url?: string; // Blob URL for preview
}

export class AssetManagerPlugin implements MDxPlugin {
    name = 'ui:asset-manager';
    private context!: PluginContext;
    // 用于存储生成的 Blob URL，以便在关闭时清理内存
    private objectUrls: string[] = [];

    install(context: PluginContext): void {
        this.context = context;
        
        // 可选：如果环境不支持 css import，可在此处手动注入样式字符串
        // this.injectStyles(); 

        // ✨ [核心修复] 立即注册按钮，确保在 TitleBar 渲染前已就绪
        context.registerTitleBarButton?.({
            id: 'asset-manager',
            title: '附件管理',
            // 图标: 回形针样式
            icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`,
            location: 'right',
            // 在点击时，我们可以从参数中获取当前的 editor 实例
            onClick: ({ editor }) => this.openAssetManager(editor)
        });
    }

    /**
     * 打开资源管理模态框
     */
    private async openAssetManager(editor: MDxEditor) {
        const engine = this.context.getSessionEngine?.();
        const nodeId = this.context.getCurrentNodeId();

        if (!engine || !nodeId) {
            Toast.error('无法连接到会话引擎');
            return;
        }

        // 1. 获取资源目录 ID
        let assetDirId: string | null = null;
        if (engine.getAssetDirectoryId) {
            assetDirId = await engine.getAssetDirectoryId(nodeId);
        }

        if (!assetDirId) {
            Toast.info('当前文档没有关联的附件目录');
            return;
        }

        // 2. 加载 UI (显示 Loading)
        const modal = this.createModalStructure();
        document.body.appendChild(modal.overlay);
        
        try {
            await this.refreshAssetList(modal, engine, assetDirId, editor);
        } catch (e) {
            console.error(e);
            Toast.error('加载附件列表失败');
            this.closeModal(modal.overlay);
        }
    }

    /**
     * 核心逻辑：获取列表、扫描引用、生成视图数据
     */
    private async refreshAssetList(
        ui: ReturnType<typeof this.createModalStructure>, 
        engine: ISessionEngine, 
        assetDirId: string,
        editor: MDxEditor // <--- 新增参数
    ) {
        ui.listContainer.innerHTML = '<div class="mdx-empty-state">Loading assets...</div>';
        
        // 1. 获取所有物理文件
        const files = await engine.getChildren(assetDirId);
        const assetFiles = files.filter(f => f.type === 'file');

        if (assetFiles.length === 0) {
            ui.listContainer.innerHTML = '<div class="mdx-empty-state">暂无附件</div>';
            this.updateToolbar(ui, 0, 0);
            return;
        }

        // 2. 扫描编辑器内容中的引用
        const content = editor.getText();
        const usedAssets = new Set<string>();
        // 匹配 @asset/filename 语法 (MDxEditor 标准)
        const assetRegex = /@asset\/([^\s)"]+)/g;
        let match;
        while ((match = assetRegex.exec(content)) !== null) {
            usedAssets.add(match[1]); // filename
        }

        // 3. 构建显示数据
        const displayItems: AssetDisplayItem[] = assetFiles.map(node => ({
            node,
            isUsed: usedAssets.has(node.name)
        }));

        // 4. 生成缩略图 (对于图片)
        // 并行加载，提高速度
        await Promise.all(displayItems.map(async (item) => {
            if (this.isImage(item.node.name)) {
                try {
                    const buffer = await engine.readContent(item.node.id);
                    const blob = new Blob([buffer], { type: this.getMimeType(item.node.name) });
                    const url = URL.createObjectURL(blob);
                    this.objectUrls.push(url);
                    item.url = url;
                } catch (e) {
                    console.warn('Failed to load preview for', item.node.name);
                }
            }
        }));

        // 5. 渲染列表
        this.renderList(ui, displayItems, engine, assetDirId, editor);
        
        // 6. 更新工具栏统计
        const unusedCount = displayItems.filter(i => !i.isUsed).length;
        this.updateToolbar(ui, displayItems.length, unusedCount, () => {
             // "清理全部" 的回调
             this.handleBatchDelete(ui, engine, assetDirId, displayItems.filter(i => !i.isUsed),editor);
        });
    }

    private renderList(
        ui: ReturnType<typeof this.createModalStructure>, 
        items: AssetDisplayItem[], 
        engine: ISessionEngine,
        assetDirId: string,
        editor: MDxEditor
    ) {
        ui.listContainer.innerHTML = '';
        
        // 排序：未引用的排前面，然后按时间倒序
        items.sort((a, b) => {
            if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
            return b.node.createdAt - a.node.createdAt;
        });

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'mdx-asset-item';

            const thumb = document.createElement('img');
            thumb.className = 'mdx-asset-thumb';
            // 如果有预览图则显示，否则显示通用图标
            thumb.src = item.url || this.getFileIcon(item.node.name); 

            const info = document.createElement('div');
            info.className = 'mdx-asset-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'mdx-asset-name';
            nameDiv.textContent = item.node.name;
            nameDiv.title = item.node.name; // Tooltip for full name

            const metaDiv = document.createElement('div');
            metaDiv.className = 'mdx-asset-meta';
            
            // 状态徽章
            const badge = document.createElement('span');
            badge.className = `mdx-asset-badge ${item.isUsed ? 'used' : 'unused'}`;
            badge.textContent = item.isUsed ? '已引用' : '未引用';
            
            // 日期
            const date = new Date(item.node.createdAt).toLocaleDateString();
            
            metaDiv.appendChild(badge);
            metaDiv.appendChild(document.createTextNode(date));

            info.appendChild(nameDiv);
            info.appendChild(metaDiv);

            const actions = document.createElement('div');
            actions.className = 'mdx-asset-actions';

            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.className = 'mdx-btn danger';
            delBtn.textContent = '删除';
            delBtn.onclick = async () => {
                if (item.isUsed) {
                    if (!confirm(`文件 "${item.node.name}" 正在被文档引用。\n强制删除会导致文档中出现图片裂图。\n\n确定要删除吗？`)) {
                        return;
                    }
                }
                await this.deleteAsset(item.node.id, engine);
                // 重新刷新
                this.refreshAssetList(ui, engine, assetDirId, editor);
            };

            // 插入编辑器按钮
            const insertBtn = document.createElement('button');
            insertBtn.className = 'mdx-btn';
            insertBtn.textContent = '插入';
            insertBtn.onclick = () => {
                const text = this.isImage(item.node.name) 
                    ? `![${item.node.name}](@asset/${item.node.name})`
                    : `[${item.node.name}](@asset/${item.node.name})`;
                
                // 将文本插入光标处
                this.insertTextToEditor(editor, text);
                Toast.success('已插入链接');
                this.closeModal(ui.overlay);
            };

            actions.appendChild(insertBtn);
            actions.appendChild(delBtn);

            li.appendChild(thumb);
            li.appendChild(info);
            li.appendChild(actions);
            ui.listContainer.appendChild(li);
        });
    }

    private updateToolbar(
        ui: ReturnType<typeof this.createModalStructure>, 
        total: number, 
        unused: number,
        onClean?: () => void
    ) {
        ui.statsEl.textContent = `共 ${total} 个附件，${unused} 个未引用`;
        
        if (unused > 0 && onClean) {
            ui.cleanBtn.style.display = 'block';
            ui.cleanBtn.onclick = onClean;
            ui.cleanBtn.textContent = `清理 ${unused} 个未引用文件`;
        } else {
            ui.cleanBtn.style.display = 'none';
        }
    }

    private async handleBatchDelete(
        ui: ReturnType<typeof this.createModalStructure>, 
        engine: ISessionEngine,
        assetDirId: string,
        itemsToDelete: AssetDisplayItem[],
        editor: MDxEditor
    ) {
        if (!confirm(`确定要永久删除这 ${itemsToDelete.length} 个文件吗？\n此操作不可撤销。`)) return;

        try {
            const ids = itemsToDelete.map(i => i.node.id);
            await engine.delete(ids);
            Toast.success(`已清理 ${ids.length} 个文件`);
            await this.refreshAssetList(ui, engine, assetDirId, editor);
        } catch (e) {
            Toast.error('批量删除失败');
            console.error(e);
        }
    }

    private async deleteAsset(id: string, engine: ISessionEngine) {
        try {
            await engine.delete([id]);
        } catch (e) {
            Toast.error('删除失败');
            console.error(e);
        }
    }

    /**
     * DOM 结构构建
     */
    private createModalStructure() {
        const overlay = document.createElement('div');
        overlay.className = 'mdx-asset-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'mdx-asset-modal';
        
        // Header
        const header = document.createElement('div');
        header.className = 'mdx-asset-header';
        const title = document.createElement('h3');
        title.textContent = '附件管理';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mdx-asset-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.closeModal(overlay);
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'mdx-asset-toolbar';
        const stats = document.createElement('span');
        const cleanBtn = document.createElement('button');
        cleanBtn.className = 'mdx-btn danger';
        toolbar.appendChild(stats);
        toolbar.appendChild(cleanBtn);

        // List
        const list = document.createElement('ul');
        list.className = 'mdx-asset-list';

        modal.appendChild(header);
        modal.appendChild(toolbar);
        modal.appendChild(list);
        overlay.appendChild(modal);

        // 点击遮罩关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) this.closeModal(overlay);
        };

        return { overlay, listContainer: list, statsEl: stats, cleanBtn };
    }

    private closeModal(overlay: HTMLElement) {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        // 清理 Blob URLs 释放内存
        this.objectUrls.forEach(url => URL.revokeObjectURL(url));
        this.objectUrls = [];
    }

    private insertTextToEditor(editor: MDxEditor, text: string) {
        const view = editor.getEditorView();
        if (view) {
            const range = view.state.selection.main;
            view.dispatch({
                changes: { from: range.from, to: range.to, insert: text }
            });
            editor.focus();
        }
    }

    // --- Helpers ---

    private isImage(filename: string): boolean {
        return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(filename);
    }

    private getMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml'
        };
        return map[ext || ''] || 'application/octet-stream';
    }

    private getFileIcon(filename: string): string {
        // 返回一个简单的 base64 svg 图标
        // 这里简化处理，实际可以使用 FontAwesome 或 icon class
        return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTE0IDJINmMyLTEuMS0yIC45LTIgMnYxNmMwIDEuMS44OSAyIDIgMmgyYzEuMSAwIDItLjkgMi0yVjhsLTYtNnptMiAxVjhsLTUgNXoiLz48L3N2Zz4='; 
    }

    destroy(): void {
        this.objectUrls.forEach(url => URL.revokeObjectURL(url));
        this.objectUrls = [];
    }
}
