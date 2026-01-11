// @file: llm-driver/utils/attachment.ts

import {blobToBase64,arrayBufferToBase64} from '@itookit/common';

/**
 * 附件处理结果
 */
export interface ProcessedAttachment {
    mimeType: string;
    base64: string;
}

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
    fallbackMimeType = 'application/octet-stream'
): Promise<ProcessedAttachment> {
    
    // Data URI
    if (typeof source === 'string' && source.startsWith('data:')) {
        const match = source.match(/^data:(.+?);base64,(.+)$/);
        if (!match) {
            throw new Error('Invalid data URI format');
        }
        return {
            mimeType: match[1],
            base64: match[2]
        };
    }
    
    // HTTP URL
    if (typeof source === 'string' && source.startsWith('http')) {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const mimeType = response.headers.get('content-type') || fallbackMimeType;
        const base64 = await blobToBase64(blob);
        
        return { mimeType, base64 };
    }
    
    // 假设是 Base64 字符串
    if (typeof source === 'string') {
        return {
            mimeType: fallbackMimeType,
            base64: source
        };
    }
    
    // File/Blob
    if (source instanceof Blob) {
        const mimeType = source.type || fallbackMimeType;
        const base64 = await blobToBase64(source);
        return { mimeType, base64 };
    }
    
    // ArrayBuffer
    if (source instanceof ArrayBuffer) {
        const base64 = arrayBufferToBase64(source);
        return {
            mimeType: fallbackMimeType,
            base64
        };
    }
    
    throw new Error('Unsupported attachment type');
}

/**
 * 检查是否为支持的视觉内容
 */
export function isSupportedVisionContent(mimeType: string): boolean {
    const supported = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp'
    ];
    return supported.includes(mimeType);
}

/**
 * 构建图片消息内容
 */
export async function buildImageContent(
    source: string | File | Blob,
    options?: { detail?: 'auto' | 'low' | 'high' }
): Promise<{ type: 'image_url'; image_url: { url: string; detail?: string } }> {
    // 如果已经是 URL 或 Data URI，直接使用
    if (typeof source === 'string' && (source.startsWith('http') || source.startsWith('data:'))) {
        return {
            type: 'image_url',
            image_url: {
                url: source,
                detail: options?.detail
            }
        };
    }
    
    // 否则转换为 Data URI
    const { mimeType, base64 } = await processAttachment(source);
    const dataUri = `data:${mimeType};base64,${base64}`;
    
    return {
        type: 'image_url',
        image_url: {
            url: dataUri,
            detail: options?.detail
        }
    };
}
