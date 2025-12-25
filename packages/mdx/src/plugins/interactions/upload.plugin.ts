/**
 * @file mdx/plugins/interactions/upload.plugin.ts
 * @desc 处理文件粘贴/拖拽上传，支持文件过滤、大小限制和自定义路径策略
 */
import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { Toast } from '@itookit/common'; 
import { 
    resolveAssetDirectory, 
    generateAssetPath, 
    AssetConfigOptions 
} from '../../core/asset-helper';

export interface UploadPluginOptions extends AssetConfigOptions {
    /** 允许的文件类型 */
    accept?: string[];
    /** 单个文件最大大小 (bytes) */
    maxSize?: number;
}

export class UploadPlugin implements MDxPlugin {
    name = 'interaction:upload';
    private context!: PluginContext;
    private options: UploadPluginOptions;

    // 默认限制
    private readonly DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
    private readonly DEFAULT_ACCEPT = [
        'image/*', 
        'application/pdf', 
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.txt', '.md', '.json'
    ];

    constructor(options: UploadPluginOptions = {}) {
        this.options = options;
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

        // 1. 解析目标目录
        const targetDirId = await resolveAssetDirectory(engine, nodeId, this.options);
        
        if (!targetDirId) {
            console.warn('[UploadPlugin] No upload target directory resolved.');
            Toast.error('无法确定上传目录，上传失败');
            return;
        }

        const placeholderId = `uploading-${Date.now()}`;
        const placeholderText = `![Uploading files... #${placeholderId}]()`;
        
        // 插入占位符
        view.dispatch({
            changes: { from: view.state.selection.main.from, insert: placeholderText }
        });

        try {
            const replacements: string[] = [];

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];

                // 2. 验证文件 (大小和类型)
                const validation = this.validateFile(file);
                if (!validation.valid) {
                    Toast.error(`文件 ${file.name}: ${validation.error}`);
                    continue;
                }

                // 3. 生成防冲突文件名
                const timestamp = Date.now();
                const lastDot = file.name.lastIndexOf('.');
                let safeName = file.name;
                
                // 简单的防冲突策略：原有文件名 + 时间戳
                // 也可以考虑 UUID，但保留原名对用户更友好
                if (lastDot !== -1) {
                    safeName = `${file.name.substring(0, lastDot)}-${timestamp}${file.name.substring(lastDot)}`;
                } else {
                    safeName = `${file.name}-${timestamp}`;
                }

                // 4. 执行上传
                const arrayBuffer = await file.arrayBuffer();
                const assetNode = await engine.createFile(safeName, targetDirId, arrayBuffer);

                // 5. 生成路径 (使用策略)
                // 如果用户配置了 target='./'，通常意味着他们想要 relative 策略，除非显式指定了 protocol
                let strategy = this.options.pathStrategy;
                if (!strategy && this.options.targetAttachmentDirectoryId === './') {
                    strategy = 'relative';
                }

                const path = generateAssetPath(assetNode.name, strategy);
                replacements.push(this.generateMarkdown(file, path));
            }

            // 6. 替换占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            
            if (startIdx >= 0) {
                // 如果所有文件都失败了，replacements 为空，直接删除占位符
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
            Toast.error('文件上传过程中发生错误');
            
            // 发生异常时移除占位符
            const currentDoc = view.state.doc.toString();
            const startIdx = currentDoc.indexOf(placeholderText);
            if (startIdx >= 0) {
                view.dispatch({
                   changes: { from: startIdx, to: startIdx + placeholderText.length, insert: '' }
                });
            }
        }
    }

    /**
     * 验证文件是否符合配置要求
     */
    private validateFile(file: File): { valid: boolean; error?: string } {
        const limit = this.options.uploadLimit || {};
        const maxSize = limit.maxSize ?? this.DEFAULT_MAX_SIZE;
        const accept = limit.accept ?? this.DEFAULT_ACCEPT;

        // 1. 检查大小
        if (file.size > maxSize) {
            const sizeMB = (maxSize / (1024 * 1024)).toFixed(1);
            return { valid: false, error: `超过大小限制 (${sizeMB}MB)` };
        }

        // 2. 检查类型
        // accept 数组可能包含 MIME type (image/*) 或 扩展名 (.pdf)
        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();
        
        const isAccepted = accept.some(rule => {
            const r = rule.toLowerCase().trim();
            if (r.startsWith('.')) {
                // 扩展名匹配
                return fileName.endsWith(r);
            } else if (r.endsWith('/*')) {
                // 通配符 MIME 匹配 (e.g. image/*)
                const prefix = r.slice(0, -2); // remove /*
                return fileType.startsWith(prefix);
            } else {
                // 精确 MIME 匹配
                return fileType === r;
            }
        });

        if (!isAccepted) {
            return { valid: false, error: '不支持的文件类型' };
        }

        return { valid: true };
    }

    private generateMarkdown(file: File, path: string): string {
        const type = file.type.toLowerCase();
        // 图片显示为图片语法
        if (type.startsWith('image/')) return `![${file.name}](${path})`;
        // PDF 可以尝试使用 embed 语法 (取决于渲染器支持)
        if (type === 'application/pdf') return `![embed](${path})`;
        // 其他文件显示为链接
        return `[${file.name}](${path})`;
    }
}