// @file: llm-engine/session/services/attachment-processor-service.ts

import { guessMimeType, MarkdownAnalyzer } from '@itookit/common';
import { type Attachment } from '@itookit/llm-driver';
import { ChatFile } from '../../core/types';
import { PersistenceAdapter } from '../../adapters/persistence-adapter';

/**
 * 附件处理服务
 * 负责文件解析、转换和加载
 */
export class AttachmentProcessorService {
    private markdownAnalyzer = new MarkdownAnalyzer();

    constructor(private persistence: PersistenceAdapter) {}

    /**
     * 从消息文本中解析并加载附件
     */
    async resolveAttachmentsFromMessage(
        sessionId: string,
        text: string,
        inputFiles: ChatFile[]
    ): Promise<ChatFile[]> {
        const contextFiles: ChatFile[] = [];
        const processedFilenames = new Set<string>();

        // 使用 MarkdownAnalyzer 提取引用
        const analysisResult = await this.markdownAnalyzer.analyze(text, {
            filePath: 'message.md'
        });

        // 处理分析出的文件引用
        for (const filename of analysisResult.references) {
            if (processedFilenames.has(filename)) continue;
            processedFilenames.add(filename);

            // 策略 A: 优先从 inputFiles (内存中) 查找
            const memoryFile = inputFiles.find(f => f.name === filename);

            if (memoryFile) {
                contextFiles.push(memoryFile);
            } else {
                // 策略 B: 从 VFS 持久化层读取
                const file = await this.loadFromVFS(sessionId, filename);
                if (file) {
                    contextFiles.push(file);
                }
            }
        }

        // 策略 C: 隐式包含未引用的文件
        for (const inFile of inputFiles) {
            if (!processedFilenames.has(inFile.name)) {
                contextFiles.push(inFile);processedFilenames.add(inFile.name);
            }
        }

        return contextFiles;
    }

    /**
     * 从 VFS 加载文件
     */
    private async loadFromVFS(
        sessionId: string,
        filename: string
    ): Promise<ChatFile | null> {
        try {
            const blob = await this.persistence.readAsset(sessionId, filename);

            if (blob) {
                return {
                    name: filename,
                    type: blob.type || guessMimeType(filename),
                    path: `./${filename}`,
                    size: blob.size,
                    fileRef: blob
                };
            }
        } catch (e) {
            console.error(`[AttachmentProcessor] Failed to load: ${filename}`, e);
        }
        return null;
    }

    /**
     * 将 ChatFile 数组转换为 File 数组
     */
    async convertToFiles(
        sessionId: string,
        chatFiles: ChatFile[]
    ): Promise<File[]> {
        const files: File[] = [];

        for (const cf of chatFiles) {
            const file = await this.chatFileToFile(sessionId, cf);
            if (file) {
                files.push(file);
            }
        }

        return files;
    }

    /**
     * 单个 ChatFile 转 File
     */
    private async chatFileToFile(
        sessionId: string,
        cf: ChatFile
    ): Promise<File | null> {
        if (cf instanceof File) {
            return cf;
        }

        if (cf.fileRef instanceof File) {
            return cf.fileRef;
        }

        if (cf.fileRef instanceof Blob) {
            return new File([cf.fileRef], cf.name, {
                type: cf.type || 'application/octet-stream'
            });
        }

        if (cf.path) {
            try {
                const blob = await this.persistence.readAsset(sessionId, cf.name);
                if (blob) {
                    return new File([blob], cf.name, {
                        type: cf.type || blob.type || 'application/octet-stream'
                    });
                }
            } catch (e) {
                console.warn(`[AttachmentProcessor] Failed to load: ${cf.name}`);
            }
        }

        return null;
    }

    /**
     * 转换为 LLM Driver 的 Attachment 格式
     */
    async convertToAttachments(files: (ChatFile | File)[]): Promise<Attachment[]> {
        const attachments: Attachment[] = [];

        for (const file of files) {
            let source: File | Blob;
            let filename: string;
            let mimeType: string;

            if (file instanceof File) {
                source = file;
                filename = file.name;
                mimeType = file.type || guessMimeType(file.name);
            } else if (file.fileRef) {
                source = file.fileRef;
                filename = file.name;
                mimeType = file.type || guessMimeType(file.name);
            } else {
                console.warn(`[AttachmentProcessor] Skipping: ${file.name}`);
                continue;
            }

            attachments.push({
                type: this.mimeToAttachmentType(mimeType),
                source,
                mimeType,
                filename
            });
        }

        return attachments;
    }

    /**
     * MIME 类型转附件类型
     */
    mimeToAttachmentType(mimeType: string): 'image' | 'audio' | 'video' | 'file' {
        if (!mimeType) return 'file';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.startsWith('video/')) return 'video';
        return 'file';
    }

    /**
     * 剥离 fileRef 用于持久化
     */
    stripFileRefs(files: ChatFile[]): Omit<ChatFile, 'fileRef'>[] {
        return files.map(f => ({
            name: f.name,
            type: f.type,
            path: f.path,
            size: f.size
        }));
    }
}
