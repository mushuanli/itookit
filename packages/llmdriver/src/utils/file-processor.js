/**
 * @file src/utils/file-processor.js
 * @description Handles conversion of various attachment sources to base64.
 * Works in both Node.js and Browser environments.
 */

/**
 * Converts value to Uint8Array in a platform-agnostic way
 */
async function toUint8Array(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        const arrayBuffer = await value.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    // Handle Node.js Buffer
    if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
        return new Uint8Array(value);
    }
    throw new Error('Unsupported type for conversion.');
}

/**
 * Converts Uint8Array to base64 string (works in both Node and Browser)
 */
function uint8ArrayToBase64(uint8Array) {
    // Browser environment
    if (typeof btoa !== 'undefined') {
        const binaryString = Array.from(uint8Array)
            .map(byte => String.fromCharCode(byte))
            .join('');
        return btoa(binaryString);
    }
    
    // Node.js environment
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(uint8Array).toString('base64');
    }
    
    throw new Error('No base64 encoding method available');
}

/**
 * Processes various attachment sources into base64 format
 * @param {File | Blob | Buffer | string} source - The attachment source
 * @param {string} [fallbackMimeType='application/octet-stream'] - Default MIME type
 * @returns {Promise<{mimeType: string, base64: string}>}
 */
export async function processAttachment(source, fallbackMimeType = 'application/octet-stream') {
    // Handle data URI strings
    if (typeof source === 'string') {
        if (source.startsWith('data:')) {
            const match = source.match(/^data:(.+?);base64,(.+)$/);
            if (!match) throw new Error('Invalid base64 data URI format.');
            return { mimeType: match[1], base64: match[2] };
        }
        
        // Handle HTTP/HTTPS URLs
        if (source.startsWith('http')) {
            const response = await fetch(source);
            if (!response.ok) {
                throw new Error(`Failed to fetch from ${source}: ${response.statusText}`);
            }
            const blob = await response.blob();
            const uint8Array = await toUint8Array(blob);
            const base64 = uint8ArrayToBase64(uint8Array);
            return { 
                mimeType: response.headers.get('content-type') || blob.type || fallbackMimeType,
                base64 
            };
        }
        
        // Assume raw base64 string
        return { mimeType: fallbackMimeType, base64: source };
    }

    // Handle File/Blob (Browser)
    if (typeof File !== 'undefined' && source instanceof File) {
        const uint8Array = await toUint8Array(source);
        const base64 = uint8ArrayToBase64(uint8Array);
        return { mimeType: source.type || fallbackMimeType, base64 };
    }
    
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
        const uint8Array = await toUint8Array(source);
        const base64 = uint8ArrayToBase64(uint8Array);
        return { mimeType: source.type || fallbackMimeType, base64 };
    }

    // Handle Buffer (Node.js) or ArrayBuffer
    if (source instanceof ArrayBuffer || 
        (typeof Buffer !== 'undefined' && source instanceof Buffer)) {
        const uint8Array = await toUint8Array(source);
        const base64 = uint8ArrayToBase64(uint8Array);
        return { mimeType: fallbackMimeType, base64 };
    }

    throw new Error('Unsupported attachment source type. Supported: URL, base64 string, File, Blob, Buffer, ArrayBuffer');
}
