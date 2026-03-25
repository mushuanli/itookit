// @file: device-llm/utils/attachment.ts

import { blobToBase64, arrayBufferToBase64 } from '@itookit/common';
import {
    MessageContentPart,
    MessageContentImage,
    MessageContentAudio,
    MessageContentVideo,
    MessageContentFile,
    Attachment
} from '../types/message';

/**
 * 附件处理结果
 */
export interface ProcessedAttachment {
    mimeType: string;
    base64: string;
    filename?: string;
    size?: number;
}

/**
 * 支持的媒体类型
 */
export const SUPPORTED_MEDIA_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    audio: ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/webm'],
    video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    document: [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'application/xml',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
} as const;

/**
 * 处理附件为 Base64 格式
 * 
 * 支持：
 * - Data URI
 * - HTTP URL
 * - File/Blob
 * - ArrayBuffer
 * - Base64 字符串
 */
export async function processAttachment(
    source: string | File | Blob | ArrayBuffer,
    options?: {
        fallbackMimeType?: string;
        maxSize?: number;
        allowedTypes?: string[];
    }
): Promise<ProcessedAttachment> {
    const {
        fallbackMimeType = 'application/octet-stream',
        maxSize,
        allowedTypes
    } = options || {};

    let mimeType: string;
    let base64: string;
    let filename: string | undefined;
    let size: number | undefined;

    // Data URI
    if (typeof source === 'string' && source.startsWith('data:')) {
        const match = source.match(/^data:(.+?);base64,(.+)$/);
        if (!match) {
            throw new Error('Invalid data URI format');
        }
        mimeType = match[1];
        base64 = match[2];
        size = Math.ceil((base64.length * 3) / 4);
    }
    // HTTP URL
    else if (typeof source === 'string' && source.startsWith('http')) {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const blob = await response.blob();
        mimeType = response.headers.get('content-type')?.split(';')[0] || fallbackMimeType;
        base64 = await blobToBase64(blob);
        size = blob.size;

        // 尝试从 URL 提取文件名
        const urlPath = new URL(source).pathname;
        filename = urlPath.split('/').pop() || undefined;
    }
    // Base64 字符串
    else if (typeof source === 'string') {
        mimeType = fallbackMimeType;
        base64 = source;
        size = Math.ceil((base64.length * 3) / 4);
    }
    // File
    else if (source instanceof File) {
        mimeType = source.type || fallbackMimeType;
        base64 = await blobToBase64(source);
        filename = source.name;
        size = source.size;
    }
    // Blob
    else if (source instanceof Blob) {
        mimeType = source.type || fallbackMimeType;
        base64 = await blobToBase64(source);
        size = source.size;
    }
    // ArrayBuffer
    else if (source instanceof ArrayBuffer) {
        mimeType = fallbackMimeType;
        base64 = arrayBufferToBase64(source);
        size = source.byteLength;
    }
    else {
        throw new Error('Unsupported attachment type');
    }

    // 大小检查
    if (maxSize && size && size > maxSize) {
        throw new Error(`Attachment size ${size} exceeds maximum ${maxSize}`);
    }

    // 类型检查
    if (allowedTypes && !allowedTypes.includes(mimeType)) {
        throw new Error(`MIME type ${mimeType} is not allowed`);
    }

    return { mimeType, base64, filename, size };
}

/**
 * 检测媒体类型
 */
export function detectMediaType(mimeType: string): 'image' | 'audio' | 'video' | 'document' | 'unknown' {
    if (SUPPORTED_MEDIA_TYPES.image.includes(mimeType as any)) return 'image';
    if (SUPPORTED_MEDIA_TYPES.audio.includes(mimeType as any)) return 'audio';
    if (SUPPORTED_MEDIA_TYPES.video.includes(mimeType as any)) return 'video';
    if (SUPPORTED_MEDIA_TYPES.document.includes(mimeType as any)) return 'document';
    return 'unknown';
}

/**
 * 检查是否为支持的视觉内容
 */
export function isSupportedVisionContent(mimeType: string): boolean {
    return SUPPORTED_MEDIA_TYPES.image.includes(mimeType as any);
}

/**
 * 检查是否为支持的音频内容
 */
export function isSupportedAudioContent(mimeType: string): boolean {
    return SUPPORTED_MEDIA_TYPES.audio.includes(mimeType as any);
}

/**
 * 检查是否为支持的视频内容
 */
export function isSupportedVideoContent(mimeType: string): boolean {
    return SUPPORTED_MEDIA_TYPES.video.includes(mimeType as any);
}

/**
 * 构建图片消息内容 - 增强版
 */
export async function buildImageContent(
    source: string | File | Blob,
    options?: {
        detail?: 'auto' | 'low' | 'high';
        format?: 'openai' | 'anthropic' | 'gemini';
    }
): Promise<MessageContentImage> {
    const { detail, format = 'openai' } = options || {};

    // 如果已经是 URL，直接使用
    if (typeof source === 'string' && (source.startsWith('http') || source.startsWith('data:'))) {
        if (format === 'anthropic' && source.startsWith('data:')) {
            const [header, data] = source.split(',');
            const mediaType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data
                }
            };
        }

        return {
            type: 'image_url',
            image_url: {
                url: source,
                detail
            }
        };
    }

    // 转换为 Base64
    const { mimeType, base64 } = await processAttachment(source, {
        allowedTypes: SUPPORTED_MEDIA_TYPES.image as unknown as string[]
    });

    if (format === 'anthropic') {
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mimeType,
                data: base64
            }
        };
    }

    const dataUri = `data:${mimeType};base64,${base64}`;
    return {
        type: 'image_url',
        image_url: {
            url: dataUri,
            detail
        }
    };
}

/**
 * 构建音频消息内容 (新增)
 */
export async function buildAudioContent(
    source: string | File | Blob | ArrayBuffer,
    options?: {
        format?: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';
    }
): Promise<MessageContentAudio> {
    const { mimeType, base64 } = await processAttachment(source, {
        allowedTypes: SUPPORTED_MEDIA_TYPES.audio as unknown as string[]
    });

    // 定义音频格式类型
    type AudioFormat = 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';

    // 推断格式 - 修复类型问题
    let format: AudioFormat;
    
    if (options?.format) {
        format = options.format;
    } else {
        const formatMap: Record<string, AudioFormat> = {
            'audio/wav': 'wav',
            'audio/mp3': 'mp3',
            'audio/mpeg': 'mp3',
            'audio/flac': 'flac',
            'audio/ogg': 'opus'
        };
        // 使用默认值 'wav' 确保不为 undefined
        format = formatMap[mimeType] ?? 'wav';
    }

    return {
        type: 'input_audio',
        input_audio: {
            data: base64,
            format
        }
    };
}

/**
 * 构建视频消息内容 (新增)
 */
export async function buildVideoContent(
    source: string | File | Blob,
    options?: {
        duration?: number;
    }
): Promise<MessageContentVideo> {
    // URL 直接使用
    if (typeof source === 'string' && source.startsWith('http')) {
        return {
            type: 'video',
            video: {
                source: 'url',
                url: source,
                duration: options?.duration
            }
        };
    }

    const { mimeType, base64 } = await processAttachment(source, {
        allowedTypes: SUPPORTED_MEDIA_TYPES.video as unknown as string[]
    });

    return {
        type: 'video',
        video: {
            source: 'base64',
            data: base64,
            mime_type: mimeType,
            duration: options?.duration
        }
    };
}

/**
 * 构建文件消息内容 (新增)
 */
export async function buildFileContent(
    source: string | File | Blob,
    options?: {
        filename?: string;
    }
): Promise<MessageContentFile> {
    // URL 直接使用
    if (typeof source === 'string' && source.startsWith('http')) {
        return {
            type: 'file',
            file: {
                source: 'url',
                url: source,
                filename: options?.filename
            }
        };
    }

    const { mimeType, base64, filename } = await processAttachment(source);

    return {
        type: 'file',
        file: {
            source: 'base64',
            data: base64,
            mime_type: mimeType,
            filename: options?.filename || filename
        }
    };
}

/**
 * 将 Attachment 转换为 MessageContentPart (新增)
 */
export async function attachmentToContentPart(
    attachment: Attachment,
    providerFormat?: 'openai' | 'anthropic' | 'gemini'
): Promise<MessageContentPart> {
    switch (attachment.type) {
        case 'image':
            return buildImageContent(attachment.source as string | File | Blob, {
                detail: attachment.options?.detail,
                format: providerFormat
            });

        case 'audio':
            return buildAudioContent(attachment.source, {
                format: attachment.options?.format as any
            });

        case 'video':
            return buildVideoContent(attachment.source as string | File | Blob);

        case 'file':
            return buildFileContent(attachment.source as string | File | Blob, {
                filename: attachment.filename
            });

        default:
            throw new Error(`Unsupported attachment type: ${attachment.type}`);
    }
}

/**
 * 批量处理附件 (新增)
 */
export async function processAttachments(
    attachments: Attachment[],
    providerFormat?: 'openai' | 'anthropic' | 'gemini'
): Promise<MessageContentPart[]> {
    return Promise.all(
        attachments.map(att => attachmentToContentPart(att, providerFormat))
    );
}
