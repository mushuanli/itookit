/**
 * @file mdx/plugins/interactions/upload.plugin.ts
 * @desc 处理文件粘贴/拖拽上传，以及 Titlebar 主动上传。支持文件过滤、大小限制和自定义路径策略。
 */
import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';
import { Toast } from '@itookit/common';
import { 
    getUploadLimits, 
    validateFile,
    generateAssetPath,
    AssetConfigOptions 
} from '../../core/asset-helper';

export interface UploadPluginOptions extends AssetConfigOptions {}

export class UploadPlugin implements MDxPlugin {
    name = 'interaction:upload';
    private context!: PluginContext;
    private uploadLimits: { maxSize: number; accept: string[] };
    
    // 新增：用于主动触发上传的隐藏 Input 和当前编辑器引用
    private fileInput: HTMLInputElement | null = null;
    private currentEditor: MDxEditor | null = null;

    constructor(options: UploadPluginOptions = {}) {
        this.uploadLimits = getUploadLimits(options);
    }

    install(context: PluginContext): void {
        this.context = context;
        
        // 1. 初始化隐藏的 Input 元素 (用于点击按钮上传)
        this.initHiddenInput();

        // 2. 注册 Titlebar 按钮
        context.registerToolbarButton?.({
            id: 'upload-action',
            title: '上传附件', // 鼠标悬停提示
            // 使用标准的上传图标 (Cloud Upload)
            icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>`,
            onClick: ({ editor }) => {
                this.currentEditor = editor; // 暂存当前编辑器实例，以便在 input change 时使用
                this.fileInput?.click();
            }
        });

        // 3. 注册 CodeMirror 事件 (粘贴/拖拽)
        const extension = EditorView.domEventHandlers({
            paste: (event, view) => {
                const files = event.clipboardData?.files;
                if (files && files.length > 0) {
                    event.preventDefault();
                    this.processFiles(files, view).catch(e => console.error(e));
                    return true;
                }
                return false;
            },
            drop: (event, view) => {
                const files = event.dataTransfer?.files;
                if (files && files.length > 0) {
                    event.preventDefault();
                    this.processFiles(files, view).catch(e => console.error(e));
                    return true;
                }
                return false;
            },
        });
        
        context.registerCodeMirrorExtension?.(extension);
    }

    /**
     * 初始化隐藏的文件输入框
     */
    private initHiddenInput(): void {
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.multiple = true; // ✅ 允许一次选择多个文件
        this.fileInput.style.display = 'none';
        
        // 设置接受的文件类型 (为了 UI 体验，安全性在 processFiles 再次校验)
        if (this.uploadLimits.accept.length > 0) {
            this.fileInput.accept = this.uploadLimits.accept.join(',');
        }

        document.body.appendChild(this.fileInput);

        // 监听文件选择变化
        this.fileInput.addEventListener('change', async () => {
            const files = this.fileInput?.files;
            if (!files || files.length === 0) return;

            // 获取编辑器视图
            const view = this.currentEditor?.getEditorView();
            
            if (view) {
                // 聚焦编辑器，确保插入位置正确
                view.focus(); 
                await this.processFiles(files, view);
            } else {
                Toast.error('无法获取编辑器实例');
            }

            // 清空 value，允许重复选择同一个文件
            if (this.fileInput) this.fileInput.value = '';
        });
    }

    /**
     * 核心处理逻辑：校验 -> 上传 -> 替换 Markdown
     */
    private async processFiles(fileList: FileList, view: EditorView): Promise<void> {
        const engine = this.context.getSessionEngine?.();
        // ✅ 获取 ownerNodeId (由 EditorOptions 传入，或默认为 nodeId)
        const ownerNodeId = this.context.getOwnerNodeId?.();
        
        if (!engine) {
            console.warn('[UploadPlugin] No engine available.');
            Toast.error('上传服务不可用');
            return;
        }

        if (!ownerNodeId) {
            console.warn('[UploadPlugin] No ownerNodeId defined.');
            Toast.error('无法确定资产归属，上传失败');
            return;
        }

        const placeholderId = `upload-${Date.now().toString(36)}`;
        const placeholderText = `![Uploading ${fileList.length} files... #${placeholderId}]()`;
        
        // 1. 插入上传占位符 (在光标位置)
        const { from } = view.state.selection.main;
        view.dispatch({
            changes: { from, insert: placeholderText }
        });

        try {
            const replacements: string[] = [];
            const errors: string[] = [];

            // 2. 遍历处理所有文件
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];

                // 2.1 验证文件 (安全性限制: 大小, 类型)
                const validation = validateFile(file, this.uploadLimits);
                if (!validation.valid) {
                    const msg = `文件 ${file.name}: ${validation.error}`;
                    errors.push(msg);
                    console.warn(msg);
                    continue;
                }

                // 2.2 生成安全文件名 (Engine 层可能还会处理重名)
                const safeName = this.generateSafeFilename(file.name);
                const arrayBuffer = await file.arrayBuffer();

                // 2.3 ✅ 调用 Engine 创建资产
                // 注意：VFSCore 会根据 arrayBuffer 自动标记 isBinary: true
                // MiddlewareRegistry 会根据此标记跳过 PlainTextMiddleware
                const assetNode = await engine.createAsset(ownerNodeId, safeName, arrayBuffer);
                
                // 2.4 生成 @asset/ 路径 Markdown
                const path = generateAssetPath(assetNode.name);
                replacements.push(this.generateMarkdown(file, path));
            }

            // 3. 处理错误提示
            if (errors.length > 0) {
                Toast.error(`部分文件上传失败:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '...' : ''}`);
            }

            // 4. 替换占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            
            if (startIdx >= 0) {
                // 如果所有文件都失败了，replacements 为空，直接删除占位符
                // 如果有成功的，插入 Markdown，并在末尾加个换行符保持格式整洁
                const finalText = replacements.length > 0 
                    ? '\n' + replacements.join('\n') + '\n' 
                    : '';

                view.dispatch({
                    changes: {
                        from: startIdx,
                        to: startIdx + placeholderText.length,
                        insert: finalText
                    },
                    // 更新光标位置到插入内容之后
                    selection: { anchor: startIdx + finalText.length }
                });
                
                if (replacements.length > 0) {
                    Toast.success(`成功上传 ${replacements.length} 个文件`);
                }
            }

        } catch (error) {
            console.error('[UploadPlugin] Upload failed:', error);
            Toast.error('上传过程中发生错误');
            
            // 发生严重错误时清理占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            if (startIdx >= 0) {
                view.dispatch({
                   changes: { from: startIdx, to: startIdx + placeholderText.length, insert: '' }
                });
            }
        }
    }

    private generateSafeFilename(originalName: string): string {
        // 简单清理文件名，保留扩展名
        // 例如: "My File (1).png" -> "My_File_1_.png"
        return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    private generateMarkdown(file: File, path: string): string {
        if (file.type.startsWith('image/')) return `![${file.name}](${path})`;
        if (file.type === 'application/pdf') return `![${file.name}](${path})`; // 通常渲染器会特殊处理 PDF
        return `[${file.name}](${path})`; // 其他文件作为下载链接
    }

    destroy(): void {
        // 清理 DOM 元素
        if (this.fileInput && this.fileInput.parentNode) {
            this.fileInput.parentNode.removeChild(this.fileInput);
        }
        this.fileInput = null;
        this.currentEditor = null;
    }
}