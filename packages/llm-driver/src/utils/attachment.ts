// @file: llm-driver/utils/attachment.ts

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
 * Blob 转 Base64
 */
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // 移除 data URI 前缀
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    
    // 浏览器环境
    if (typeof btoa !== 'undefined') {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    // Node.js 环境
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    
    throw new Error('No base64 encoding method available');
}

/**
 * 获取文件扩展名对应的 MIME 类型
 */
export function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const mimeTypes: Record<string, string> = {
        // 图片
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        
        // 文档
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'txt': 'text/plain',
        'md': 'text/markdown',
        
        // 代码
        'json': 'application/json',
        'js': 'text/javascript',
        'ts': 'text/typescript',
        'py': 'text/x-python',
        'html': 'text/html',
        'css': 'text/css',
        'xml': 'application/xml',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        
        // 音频
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        
        // 视频
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        
        // 压缩
        'zip': 'application/zip',
        'gz': 'application/gzip',
        'tar': 'application/x-tar'
    };
    
    return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * 检查是否为图片类型
 */
export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
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
