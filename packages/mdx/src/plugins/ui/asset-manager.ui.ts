/**
 * @file mdx/plugins/ui/asset-manager.ui.ts
 * @desc 独立的资源管理器 UI 类，不绑定 MDxPlugin 上下文
 */
import { Toast, type ISessionEngine, type EngineNode } from '@itookit/common';
import type { MDxEditor } from '../../editor/editor';

interface AssetDisplayItem {
    node: EngineNode;
    isUsed: boolean;
    url?: string; // Blob URL for preview
}

export class AssetManagerUI {
    private objectUrls: string[] = [];
    private overlay: HTMLElement | null = null;
    
    // 使用 ! 断言它们在 createModalStructure 后一定存在
    private listContainer!: HTMLElement;
    private statsEl!: HTMLElement;
    private cleanBtn!: HTMLElement;

    constructor(
        private engine: ISessionEngine,
        private editor: MDxEditor 
    ) {}

    /**
     * 显示资源管理器
     * @param assetDirId 目标资源目录的 ID
     */
    public async show(assetDirId: string) {
        // 1. 构建基础 DOM
        this.createModalStructure();
        if (this.overlay) {
            document.body.appendChild(this.overlay);
        }

        try {
            await this.refreshAssetList(assetDirId);
        } catch (e) {
            console.error(e);
            Toast.error('加载附件列表失败');
            this.close();
        }
    }

    public close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        // 清理内存
        this.objectUrls.forEach(url => URL.revokeObjectURL(url));
        this.objectUrls = [];
    }

    private async refreshAssetList(assetDirId: string) {
        if (!this.listContainer) return;
        
        this.listContainer.innerHTML = '<div class="mdx-empty-state">Loading assets...</div>';

        // 1. 获取文件
        let files: EngineNode[] = [];
        try {
             files = await this.engine.getChildren(assetDirId);
        } catch (e) {
             console.error('Failed to get children', e);
             this.listContainer.innerHTML = '<div class="mdx-empty-state">读取目录失败</div>';
             return;
        }
        
        const assetFiles = files.filter(f => f.type === 'file');

        if (assetFiles.length === 0) {
            this.listContainer.innerHTML = '<div class="mdx-empty-state">暂无附件</div>';
            this.updateToolbar(0, 0, () => {});
            return;
        }

        // 2. 扫描引用 (支持 @asset/ 和 ./ 相对路径)
        const content = this.editor.getText();
        const usedAssets = new Set<string>();
        
        // 匹配 @asset/filename
        const assetRegex = /@asset\/([^\s)"]+)/g;
        let match;
        while ((match = assetRegex.exec(content)) !== null) {
            usedAssets.add(match[1]);
        }
        
        // 匹配 ./filename 或 filename (相对路径)
        // 简单正则，匹配 ](./filename) 或 ](filename)
        // 注意：排除 http://, https://, data:
        const relativeRegex = /\]\(\s*(\.\/)?([^\/)]+)\s*\)/g;
        while ((match = relativeRegex.exec(content)) !== null) {
            const filename = match[2];
            if (!filename.startsWith('http') && !filename.startsWith('data:')) {
                usedAssets.add(filename);
            }
        }

        const displayItems: AssetDisplayItem[] = assetFiles.map(node => ({
            node,
            isUsed: usedAssets.has(node.name)
        }));

        // 3. 生成预览 (并发加载)
        await Promise.all(displayItems.map(async (item) => {
            if (this.isImage(item.node.name)) {
                try {
                    const buffer = await this.engine.readContent(item.node.id);
                    const mimeType = this.getMimeType(item.node.name);
                    const blob = new Blob([buffer], { type: mimeType });
                    const url = URL.createObjectURL(blob);
                    this.objectUrls.push(url);
                    item.url = url;
                } catch (e) {
                    console.warn('Preview load failed', item.node.name);
                }
            }
        }));

        this.renderList(displayItems, assetDirId);
        
        const unusedCount = displayItems.filter(i => !i.isUsed).length;
        this.updateToolbar(displayItems.length, unusedCount, () => {
             this.handleBatchDelete(assetDirId, displayItems.filter(i => !i.isUsed));
        });
    }

    // [修复] 新增此方法
    private updateToolbar(total: number, unused: number, onClean: () => void) {
        if (!this.statsEl || !this.cleanBtn) return;
        
        this.statsEl.textContent = `共 ${total} 个附件，${unused} 个未引用`;
        
        if (unused > 0) {
            this.cleanBtn.style.display = 'block';
            this.cleanBtn.textContent = `清理 ${unused} 个未引用`;
            this.cleanBtn.onclick = onClean;
        } else {
            this.cleanBtn.style.display = 'none';
        }
    }

    private renderList(items: AssetDisplayItem[], assetDirId: string) {
        if (!this.listContainer) return;
        this.listContainer.innerHTML = '';
        
        // 排序: 未引用 > 时间倒序
        items.sort((a, b) => {
            if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
            return b.node.createdAt - a.node.createdAt;
        });

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'mdx-asset-item';

            const thumb = document.createElement('img');
            thumb.className = 'mdx-asset-thumb';
            thumb.src = item.url || this.getFileIcon();

            const info = document.createElement('div');
            info.className = 'mdx-asset-info';
            
            const dateStr = new Date(item.node.createdAt).toLocaleDateString();
            
            info.innerHTML = `
                <div class="mdx-asset-name" title="${item.node.name}">${item.node.name}</div>
                <div class="mdx-asset-meta">
                    <span class="mdx-asset-badge ${item.isUsed ? 'used' : 'unused'}">${item.isUsed ? '已引用' : '未引用'}</span>
                    ${dateStr}
                </div>
            `;

            const actions = document.createElement('div');
            actions.className = 'mdx-asset-actions';

            const insertBtn = document.createElement('button');
            insertBtn.className = 'mdx-btn';
            insertBtn.textContent = '插入';
            insertBtn.onclick = () => {
                // 默认使用 @asset/ 语法，它由 Resolver 统一处理，兼容性最好
                // 如果需要支持 ./ 语法，可以通过配置注入或简单的判断
                const text = this.isImage(item.node.name) 
                    ? `![${item.node.name}](@asset/${item.node.name})`
                    : `[${item.node.name}](@asset/${item.node.name})`;
                this.insertText(text);
                this.close();
            };

            // 2. [新增] 下载按钮
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'mdx-btn';
            downloadBtn.textContent = '下载';
            downloadBtn.style.marginLeft = '4px'; // 简单间距
            downloadBtn.onclick = () => this.handleDownload(item.node);

            // 3. 删除按钮
            const delBtn = document.createElement('button');
            delBtn.className = 'mdx-btn danger';
            delBtn.textContent = '删除';
            delBtn.style.marginLeft = '4px';
            delBtn.onclick = async () => {
                if (item.isUsed) {
                     if (!confirm(`文件 "${item.node.name}" 正在被引用，删除将导致文档内容缺失。\n\n确定要删除吗？`)) return;
                }
                try {
                    await this.engine.delete([item.node.id]);
                    await this.refreshAssetList(assetDirId);
                } catch(e) {
                    Toast.error('删除失败');
                }
            };

            actions.append(insertBtn, downloadBtn, delBtn);
            li.append(thumb, info, actions);
            this.listContainer.appendChild(li);
        });
    }

    /**
     * [新增] 处理文件下载
     */
    private async handleDownload(node: EngineNode) {
        try {
            // 1. 读取内容
            const content = await this.engine.readContent(node.id);
            if (!content) {
                Toast.error('文件内容为空');
                return;
            }

            // 2. 创建 Blob
            const mimeType = this.getMimeType(node.name);
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);

            // 3. 创建临时链接并点击
            const a = document.createElement('a');
            a.href = url;
            a.download = node.name; // 设置下载文件名
            document.body.appendChild(a);
            a.click();
            
            // 4. 清理
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Download failed', e);
            Toast.error('下载失败');
        }
    }

    private async handleBatchDelete(assetDirId: string, items: AssetDisplayItem[]) {
        if (!confirm(`确定要永久删除这 ${items.length} 个文件吗？`)) return;
        try {
            await this.engine.delete(items.map(i => i.node.id));
            Toast.success(`已清理 ${items.length} 个文件`);
            await this.refreshAssetList(assetDirId);
        } catch (e) {
            Toast.error('批量删除失败');
        }
    }

    private insertText(text: string) {
        const view = this.editor.getEditorView();
        if (view) {
            const range = view.state.selection.main;
            view.dispatch({ changes: { from: range.from, to: range.to, insert: text } });
            this.editor.focus();
            Toast.success('已插入链接');
        }
    }

    private createModalStructure() {
        const overlay = document.createElement('div');
        overlay.className = 'mdx-asset-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'mdx-asset-modal';
        
        // 使用 innerHTML 快速构建
        modal.innerHTML = `
            <div class="mdx-asset-header">
                <h3>附件管理</h3><button class="mdx-asset-close">&times;</button>
            </div>
            <div class="mdx-asset-toolbar">
                <span class="mdx-stats"></span>
                <button class="mdx-btn danger mdx-clean-btn" style="display:none"></button>
            </div>
            <ul class="mdx-asset-list"></ul>
        `;
        
        overlay.appendChild(modal);
        
        // 绑定引用
        this.overlay = overlay;
        this.listContainer = modal.querySelector('.mdx-asset-list') as HTMLElement;
        this.statsEl = modal.querySelector('.mdx-stats') as HTMLElement;
        this.cleanBtn = modal.querySelector('.mdx-clean-btn') as HTMLElement;
        
        const closeBtn = modal.querySelector('.mdx-asset-close') as HTMLElement;
        closeBtn.onclick = () => this.close();
        
        // 点击遮罩关闭
        overlay.onclick = (e) => { 
            if (e.target === overlay) this.close(); 
        };
    }

    private isImage(name: string) { return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name); }
    
    private getMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'mp4': 'video/mp4', 'webm': 'video/webm', 'mp3': 'audio/mpeg'
        };
        return map[ext || ''] || 'application/octet-stream';
    }

    private getFileIcon() { 
        return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTE0IDJINmMyLTEuMS0yIC45LTIgMnYxNmMwIDEuMS44OSAyIDIgMmgyYzEuMSAwIDItLjkgMi0yVjhsLTYtNnptMiAxVjhsLTUgNXoiLz48L3N2Zz4='; 
    }
}