/**
 * @file packages/llmdriver/src/utils/attachment.ts
 */

// [FIXED] 声明 Buffer 变量，解决 TS2552/TS2580 错误，无需安装 @types/node
// 这告诉 TS: "运行环境中可能有一个叫 Buffer 的全局变量，把它当做 any 处理"
declare var Buffer: any;

/**
 * Processes various attachment sources into base64 format
 */
export async function processAttachment(
    source: string | File | Blob | ArrayBuffer | any, 
    fallbackMimeType = 'application/octet-stream'
): Promise<{ mimeType: string; base64: string }> {
    
    // Helper to convert to Base64
    const toBase64 = (buffer: Uint8Array): string => {
        // [FIXED] 使用 typeof 检查，配合上面的 declare，TS 不会报错，且运行时安全
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(buffer).toString('base64');
        }
        if (typeof btoa !== 'undefined') {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        }
        throw new Error('No base64 encoding method available');
    };

    // Helper to get Uint8Array
    const toUint8Array = async (val: any): Promise<Uint8Array> => {
        if (val instanceof Uint8Array) return val;
        if (typeof Blob !== 'undefined' && val instanceof Blob) return new Uint8Array(await val.arrayBuffer());
        if (val instanceof ArrayBuffer) return new Uint8Array(val);
        if (typeof Buffer !== 'undefined' && val instanceof Buffer) return new Uint8Array(val);
        throw new Error('Unsupported type for conversion.');
    };

    // Handle String (URL or DataURI)
    if (typeof source === 'string') {
        if (source.startsWith('data:')) {
            const match = source.match(/^data:(.+?);base64,(.+)$/);
            if (!match) throw new Error('Invalid base64 data URI format.');
            return { mimeType: match[1], base64: match[2] };
        }
        if (source.startsWith('http')) {
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
            const blob = await response.blob();
            const arr = await toUint8Array(blob);
            return { 
                mimeType: response.headers.get('content-type') || fallbackMimeType, 
                base64: toBase64(arr) 
            };
        }
        // Assume raw base64
        return { mimeType: fallbackMimeType, base64: source };
    }

    // Handle File/Blob/Buffer
    const uint8Array = await toUint8Array(source);
    const mimeType = (source as any).type || fallbackMimeType;
    return { mimeType, base64: toBase64(uint8Array) };
}
