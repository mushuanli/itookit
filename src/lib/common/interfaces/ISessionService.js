/**
 * #common/interfaces/ISessionService.js
 * @file ISessionService - 定义了 SessionService 必须暴露给外部模块（如 Mention Providers）的接口。
 * @interface
 */
export class ISessionService {
    /**
     * @protected
     * @throws {Error}
     */
    constructor() {
        if (this.constructor === ISessionService) {
            throw new Error("ISessionService is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * 根据 ID 查找任何类型的项目（会话或文件夹）。
     * @param {string} itemId - 项目的唯一 ID。
     * @returns {object|undefined} 找到的项目对象，或 undefined。
     */
    findItemById(itemId) {
        throw new Error("Method 'findItemById' must be implemented.");
    }

    /**
     * [新增] 更新一个项目的元数据。
     * 这是一个通用的方法，可以用来更新标题、摘要、标签等。
     * @param {string} itemId - 要更新的项目的 ID。
     * @param {object} metadataUpdates - 一个包含要更新的元数据字段的对象，例如 { title: '新标题', summary: '新摘要' }。
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        throw new Error("Method 'updateItemMetadata' must be implemented.");
    }

    /**
     * 获取所有文件夹的扁平化列表。
     * @returns {Promise<object[]>}
     */
    async getAllFolders() {
        throw new Error("Method 'getAllFolders' must be implemented.");
    }
    
    /**
     * 获取所有文件（会话）的扁平化列表。
     * @returns {Promise<object[]>}
     */
    async getAllFiles() {
        throw new Error("Method 'getAllFiles' must be implemented.");
    }
    
    /**
     * 创建一个新的会话。
     * @param {object} options - 创建会话的选项，如 { title, content, parentId }。
     * @returns {Promise<object>} 新创建的会话对象。
     */
    async createSession(options) {
        throw new Error("Method 'createSession' must be implemented.");
    }
}
