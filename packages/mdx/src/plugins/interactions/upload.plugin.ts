/**
 * @file mdx/plugins/interactions/upload.plugin.ts
 * @desc 处理编辑器内的文件粘贴和拖拽上传，自动关联到当前节点的伴生目录。
 */

import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { Toast } from '@itookit/common'; 

export interface UploadPluginOptions {
    /** 允许的文件类型 */
    accept?: string[];
    /** 单个文件最大大小 (bytes) */
    maxSize?: number;
}

export class UploadPlugin implements MDxPlugin {
    name = 'interaction:upload';
    private context!: PluginContext;
    private options: Required<UploadPluginOptions>;

    constructor(options: UploadPluginOptions = {}) {
        this.options = {
            accept: options.accept || ['image/*', 'application/pdf', '.doc', '.docx', '.xls', '.xlsx'],
            maxSize: options.maxSize || 10 * 1024 * 1024, // 10MB
        };
    }

    install(context: PluginContext): void {
        this.context = context;
        
        // 注册 CodeMirror 扩展监听 DOM 事件
        const extension = EditorView.domEventHandlers({
            // 修复 1: 这里不能直接传 async 函数，必须是同步 wrapper
            paste: (event, view) => {
                const files = event.clipboardData?.files;
                if (files && files.length > 0) {
                    event.preventDefault();
                    // 触发异步逻辑，但不返回 Promise 给 CodeMirror
                    this.processFiles(files, view).catch(e => console.error(e));
                    return true; // 告诉 CodeMirror：我处理了这个事件
                }
                return false; // 没有文件，让 CodeMirror 执行默认粘贴（比如粘贴纯文本）
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

    private async processFiles(fileList: FileList, view: EditorView): Promise<void> {
        // 修复 2 & 3: 安全访问 context 方法
        // PluginContext 中的方法可能是可选的，或者是 undefined
        const getEngine = this.context.getSessionEngine;
        const getNodeId = this.context.getCurrentNodeId;

        if (!getEngine || !getNodeId) {
            console.warn('[UploadPlugin] Context methods not available.');
            return;
        }

        const engine = getEngine();
        const currentNodeId = getNodeId();

        if (!engine || !currentNodeId) {
            console.warn('[UploadPlugin] No session engine or node ID available.');
            return;
        }

        // 插入占位符
        const placeholderId = `uploading-${Date.now()}`;
        const placeholderText = `![Uploading files... #${placeholderId}]()`;
        
        const transaction = view.state.update({
            changes: { from: view.state.selection.main.from, insert: placeholderText }
        });
        view.dispatch(transaction);

        try {
            const replacements: string[] = [];

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                
                if (file.size > this.options.maxSize) {
                    Toast.error(`文件 ${file.name} 超过大小限制`);
                    continue;
                }

                // 2. 生成防冲突文件名
                // 格式: filename-timestamp.ext
                const timestamp = Date.now();
                const lastDot = file.name.lastIndexOf('.');
                let safeName = file.name;
                
                if (lastDot !== -1) {
                    const name = file.name.substring(0, lastDot);
                    const ext = file.name.substring(lastDot);
                    safeName = `${name}-${timestamp}${ext}`;
                } else {
                    safeName = `${file.name}-${timestamp}`;
                }

                // 2. 上传 (使用 createAsset)
                const arrayBuffer = await file.arrayBuffer();
                
                // 修复 4: 确保 engine 上有 createAsset 方法 (类型守卫)
                if (!('createAsset' in engine) || typeof (engine as any).createAsset !== 'function') {
                    throw new Error('SessionEngine does not support createAsset');
                }

                const assetNode = await engine.createAsset(currentNodeId, safeName, arrayBuffer);

                // 4. 生成 Markdown (使用 @asset/ 语法)
                const relativePath = `@asset/${assetNode.name}`; 

                const markdown = this.generateMarkdown(file, relativePath);
                replacements.push(markdown);
            }

            // 4. 替换占位符
            if (replacements.length > 0) {
                const finalText = replacements.join('\n');
                // 重新获取文档状态，因为在 await 期间文档可能已变动
                // 更好的做法是使用 CodeMirror 的 mapPos，但简单场景下搜索字符串亦可
                const currentDoc = view.state.doc.toString();
                const startIdx = currentDoc.indexOf(placeholderText);
                
                if (startIdx >= 0) {
                    view.dispatch({
                        changes: {
                            from: startIdx,
                            to: startIdx + placeholderText.length,
                            insert: finalText
                        }
                    });
                }
            } else {
                this.removePlaceholder(view, placeholderText);
            }

        } catch (error) {
            console.error('[UploadPlugin] Upload failed:', error);
            Toast.error('文件上传失败');
            this.removePlaceholder(view, placeholderText);
        }
    }

    private removePlaceholder(view: EditorView, placeholderText: string) {
        const currentDoc = view.state.doc.toString();
        const startIdx = currentDoc.indexOf(placeholderText);
        if (startIdx >= 0) {
                view.dispatch({
                changes: { from: startIdx, to: startIdx + placeholderText.length, insert: '' }
            });
        }
    }

    private generateMarkdown(file: File, path: string): string {
        const type = file.type.toLowerCase();
        
        // 图片 -> 标准 Markdown 图片
        if (type.startsWith('image/')) {
            return `![${file.name}](${path})`;
        }
        
        // PDF -> 嵌入预览 (配合 MediaPlugin)
        if (type === 'application/pdf') {
            return `![embed](${path})`; 
        }

        // Word/Excel/PPT -> 文件下载卡片 (配合 MediaPlugin 的 !file[] 语法)
        if (
            type.includes('word') || type.includes('excel') || type.includes('presentation') || // MIME check
            /\.(docx?|xlsx?|pptx?)$/i.test(file.name) // Extension check
        ) {
            return `![file[${file.name}]](${path})`;
        }

        // 其他 -> 普通链接
        return `[${file.name}](${path})`;
    }
}