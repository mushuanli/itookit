/**
 * @file src/lib/llm-fusion-kit/utils/file-processor.js
 * @description Handles conversion of various attachment sources to base64 data URI.
 * This is an isomorphic utility, designed to work in both Node.js and Browser environments.
 */

/**
 * Converts a value to a Buffer in a platform-agnostic way.
 * @param {Blob | ArrayBuffer} value - The value to convert.
 * @returns {Promise<Buffer>}
 */
async function toBuffer(value) {
    if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
        return value;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        const arrayBuffer = await value.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    throw new Error('Unsupported type for buffer conversion.');
}


/**
 * Processes various attachment sources (File, Blob, Buffer, URL, base64 string)
 * into a uniform format required by LLM APIs.
 *
 * @param {File | Blob | Buffer | string} source - The attachment source.
 * @param {string} [mimeType='application/octet-stream'] - Default MIME type if not detectable.
 * @returns {Promise<{mimeType: string, base64: string}>} - The processed attachment data.
 */
export async function processAttachment(source, mimeType) {
    // 1. Handle string inputs (base64 URI, http URL, or raw base64)
    if (typeof source === 'string') {
        if (source.startsWith('data:')) {
            const parts = source.match(/^data:(.+?);base64,(.+)$/);
            if (!parts) throw new Error('Invalid base64 data URI format.');
            return { mimeType: parts[1], base64: parts[2] };
        }
        if (source.startsWith('http')) {
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Failed to fetch image from ${source}: ${response.statusText}`);
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const base64 = (typeof Buffer !== 'undefined' ? Buffer.from(buffer) : btoa(String.fromCharCode(...new Uint8Array(buffer)))).toString('base64');
            return { mimeType: response.headers.get('content-type') || blob.type || mimeType, base64 };
        }
        // Assume it's a raw base64 string
        return { mimeType: mimeType || 'application/octet-stream', base64: source };
    }

    // 2. Handle Blob or File (Browser environment)
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                const base64 = result.substring(result.indexOf(',') + 1);
                resolve({ mimeType: source.type || mimeType, base64 });
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(source);
        });
    }

    // 3. Handle Buffer (Node.js environment)
    if (typeof Buffer !== 'undefined' && source instanceof Buffer) {
      return { mimeType: mimeType || 'application/octet-stream', base64: source.toString('base64') };
    }

    throw new Error('Unsupported attachment source type. Please provide a URL, base64 string, File/Blob, or Buffer.');
}
