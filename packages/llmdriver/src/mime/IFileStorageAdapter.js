/**
 * @file @llmdriver/src/mime/FileStorageAdapter.js
 * @interface
 * @description 定义所有文件/二进制数据存储适配器必须遵守的契约。
 */

/**
 * @typedef {object} FileUploadResult
 * @property {string} url - The accessible URL of the uploaded file.
 * @property {string} id - A unique identifier for the uploaded file.
 * @property {string} name - The original name of the file.
 * @property {number} size - The size of the file in bytes.
 * @property {string} type - The MIME type of the file.
 */

export class IFileStorageAdapter {
    /**
     * @param {object} [options] - 初始化适配器所需的配置。
     */
    constructor(options) {
        if (this.constructor === IFileStorageAdapter) {
            throw new Error("IFileStorageAdapter is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * Uploads a file to the storage.
     * @param {File} file - The file object to upload.
     * @param {object} [metadata] - Optional metadata to associate with the file.
     * @returns {Promise<FileUploadResult>} A promise that resolves with the result of the upload.
     */
    async upload(file, metadata) {
        throw new Error("Adapter must implement the 'upload' method.");
    }

    /**
     * Deletes a file from the storage.
     * @param {string} fileId - The unique identifier of the file to delete.
     * @returns {Promise<void>}
     */
    async delete(fileId) {
        throw new Error("Adapter must implement the 'delete' method.");
    }
}
