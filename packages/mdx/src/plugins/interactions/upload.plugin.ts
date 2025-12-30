/**
 * @file mdx/plugins/interactions/upload.plugin.ts
 * @desc 处理文件粘贴/拖拽上传，支持文件过滤、大小限制和自定义路径策略
 */
import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
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

    constructor(options: UploadPluginOptions = {}) {
        this.uploadLimits = getUploadLimits(options);
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
        const placeholderText = `![Uploading... #${placeholderId}]()`;
        
        // 插入占位符
        view.dispatch({
            changes: { from: view.state.selection.main.from, insert: placeholderText }
        });

        try {
            const replacements: string[] = [];

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];

                // 1. 验证文件
                const validation = validateFile(file, this.uploadLimits);
                if (!validation.valid) {
                    Toast.error(`文件 ${file.name}: ${validation.error}`);
                    continue;
                }

                // 2. 生成安全文件名
                const safeName = this.generateSafeFilename(file.name);
                const arrayBuffer = await file.arrayBuffer();

                // 3. ✅ 调用 Engine 创建资产 (不关心具体目录)
                const assetNode = await engine.createAsset(ownerNodeId, safeName, arrayBuffer);
                
                // 4. 生成 @asset/ 路径
                const path = generateAssetPath(assetNode.name);
                replacements.push(this.generateMarkdown(file, path));
            }

            // 5. 替换占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            
            if (startIdx >= 0) {
                const finalText = replacements.length > 0 ? replacements.join('\n') : '';
                view.dispatch({
                    changes: {
                        from: startIdx,
                        to: startIdx + placeholderText.length,
                        insert: finalText
                    }
                });
            }

        } catch (error) {
            console.error('[UploadPlugin] Upload failed:', error);
            Toast.error('上传发生错误');
            
            // 清理占位符
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
        // 简单清理文件名，保留扩展名，Engine 层可能还会处理重名
        return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    private generateMarkdown(file: File, path: string): string {
        if (file.type.startsWith('image/')) return `![${file.name}](${path})`;
        if (file.type === 'application/pdf') return `![${file.name}](${path})`; // Embed
        return `[${file.name}](${path})`;
    }
}