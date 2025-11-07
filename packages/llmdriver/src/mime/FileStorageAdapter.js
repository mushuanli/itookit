// @llmdriver/src/mime/FileStorageAdapter.js
import { IFileStorageAdapter } from './IFileStorageAdapter.js';

/**
 * A default "no-op" or "local preview" file storage adapter.
 * It does not perform actual uploads but generates a local Blob URL for preview purposes.
 * It will warn the user that uploads are not configured.
 */
export class FileStorageAdapter extends IFileStorageAdapter {
    constructor(options) {
        super(options);
        this.warned = false;
    }

    async upload(file, metadata) {
        if (!this.warned) {
            console.warn(
                "[FileStorageAdapter] File upload is not configured. " +
                "Using local Blob URL for preview only. Files will not be persisted across sessions."
            );
            this.warned = true;
        }

        return {
            url: URL.createObjectURL(file),
            id: `local-${file.name}-${Date.now()}`,
            name: file.name,
            size: file.size,
            type: file.type,
        };
    }

    async delete(fileId) {
        // Since the URL is a Blob URL, we can try to revoke it if we store the mapping,
        // but for a simple default, doing nothing is acceptable.
        console.warn(`[FileStorageAdapter] delete() is a no-op as files are not truly stored.`);
    }
}
