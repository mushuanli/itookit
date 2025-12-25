/**
 * @file mdx/plugins/interactions/upload.plugin.ts
 * @desc 处理文件粘贴上传，支持自定义目录配置
 */
import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { Toast } from '@itookit/common'; 
import { resolveAssetDirectory, AssetConfigOptions } from '../../core/asset-helper';

export interface UploadPluginOptions extends AssetConfigOptions {
    /** 允许的文件类型 */
    accept?: string[];
    /** 单个文件最大大小 (bytes) */
    maxSize?: number;
}

export class UploadPlugin implements MDxPlugin {
    name = 'interaction:upload';
    private context!: PluginContext;
    private options: Required<Omit<UploadPluginOptions, keyof AssetConfigOptions>> & AssetConfigOptions;

    constructor(options: UploadPluginOptions = {}) {
        this.options = {
            accept: options.accept || ['image/*', 'application/pdf', '.doc', '.docx', '.xls', '.xlsx'],
            maxSize: options.maxSize || 10 * 1024 * 1024,
            targetAttachmentDirectoryId: options.targetAttachmentDirectoryId
        };
    }

    install(context: PluginContext): void {
        this.context = context;
        
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

    private async processFiles(fileList: FileList, view: EditorView): Promise<void> {
        const engine = this.context.getSessionEngine?.();
        const nodeId = this.context.getCurrentNodeId();

        if (!engine || !nodeId) {
            console.warn('[UploadPlugin] Context not available.');
            return;
        }

        // ✨ 1. 解析目标目录
        const targetDirId = await resolveAssetDirectory(engine, nodeId, this.options);
        
        if (!targetDirId) {
            console.warn('[UploadPlugin] No upload target directory resolved.');
            Toast.error('无法确定上传目录，上传失败');
            return;
        }

        const placeholderId = `uploading-${Date.now()}`;
        const placeholderText = `![Uploading files... #${placeholderId}]()`;
        
        view.dispatch({
            changes: { from: view.state.selection.main.from, insert: placeholderText }
        });

        try {
            const replacements: string[] = [];

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                if (file.size > this.options.maxSize) {
                    Toast.error(`文件 ${file.name} 超过大小限制`);
                    continue;
                }

                // 2. 生成防冲突文件名
                const timestamp = Date.now();
                const lastDot = file.name.lastIndexOf('.');
                let safeName = file.name;
                if (lastDot !== -1) {
                    safeName = `${file.name.substring(0, lastDot)}-${timestamp}${file.name.substring(lastDot)}`;
                } else {
                    safeName = `${file.name}-${timestamp}`;
                }

                // ✨ 3. 创建文件 (不再强依赖 engine.createAsset，直接用 createFile)
                const arrayBuffer = await file.arrayBuffer();
                const assetNode = await engine.createFile(safeName, targetDirId, arrayBuffer);

                // ✨ 4. 生成路径
                // 如果是组件模式 (./)，则使用 ./filename
                // 否则默认使用 @asset/filename
                let relativePath = `@asset/${assetNode.name}`;
                if (this.options.targetAttachmentDirectoryId === './') {
                    relativePath = `./${assetNode.name}`;
                }

                replacements.push(this.generateMarkdown(file, relativePath));
            }

            // 替换占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            
            if (startIdx >= 0) {
                const finalText = replacements.join('\n');
                view.dispatch({
                    changes: {
                        from: startIdx,
                        to: startIdx + placeholderText.length,
                        insert: finalText || ''
                    }
                });
            }

        } catch (error) {
            console.error('[UploadPlugin] Upload failed:', error);
            Toast.error('文件上传失败');
            // 移除占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            if (startIdx >= 0) {
                view.dispatch({
                   changes: { from: startIdx, to: startIdx + placeholderText.length, insert: '' }
                });
            }
        }
    }

    private generateMarkdown(file: File, path: string): string {
        const type = file.type.toLowerCase();
        if (type.startsWith('image/')) return `![${file.name}](${path})`;
        if (type === 'application/pdf') return `![embed](${path})`;
        return `[${file.name}](${path})`;
    }
}