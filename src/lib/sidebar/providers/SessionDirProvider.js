// #sidebar/providers/SessionDirProvider.js

import { IMentionProvider } from '../../common/interfaces/IMentionProvider.js';

/**
 * @class
 * @implements {IMentionProvider}
 * 为 sessionUI 中的文件夹（目录）提供 @mention 风格的自动完成和交互功能。
 * 它从 SessionService 获取数据。
 */
export class SessionDirProvider extends IMentionProvider {
    /**
     * 对应于 mdx://dir/folder-id URI 格式。
     * @type {string}
     */
    key = 'dir';

    /**
     * 触发此 Provider 的字符。
     * @type {string}
     */
    triggerChar = '@';

    /**
     * @param {object} dependencies
     * @param {import('../../common/interfaces/ISessionService.js').ISessionService} dependencies.sessionService
     */
    // +++ START MODIFICATION +++
    constructor({ sessionService }) {
    // +++ END MODIFICATION +++
        super();
        if (!sessionService) {
            throw new Error("SessionDirProvider requires an ISessionService instance.");
        }
        this.sessionService = sessionService;
    }
    
    // [MODIFIED] Added this method to align with service-oriented architecture
    async getAllFolders() {
        return this.sessionService.getAllFolders();
    }

    /**
     * 根据查询字符串获取文件夹建议。
     * @param {string} query - 用户在 '@dir:' 后输入的搜索字符串。
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        // --- [核心修复] ---
        // 不再直接访问 store (this.sessionService.store.getState())，
        // 而是调用 SessionService 提供的标准公共接口。
        // 这遵循了依赖倒置原则，增强了代码的封装性和可维护性。
        const allFolders = await this.sessionService.getAllFolders();
        const lowerQuery = query.toLowerCase();

        return allFolders
            // [MODIFIED] Access title from metadata
            .filter(folder => folder.metadata.title.toLowerCase().includes(lowerQuery))
            .map(folder => ({
                id: folder.id,
                // [MODIFIED] Access title from metadata
                label: `📁 ${folder.metadata.title}`
            }));
    }

    /**
     * 为悬停的链接提供预览内容。
     * @param {URL} targetURL - mdx:// URI
     * @returns {Promise<{title: string, contentHTML: string, icon: string} | null>}
     */
    async getHoverPreview(targetURL) {
        const folderId = targetURL.pathname.substring(1); // 移除前导的 '/'
        const folder = this.sessionService.findItemById(folderId);
        if (folder?.type === 'folder') {
            const childCount = folder.children?.length || 0;
            return { title: folder.metadata.title, contentHTML: `<p>包含 ${childCount} 个项目。</p>`, icon: '📁' };
        }
        return null;
    }

    /**
     * 处理对文件夹链接的点击事件。
     * @param {URL} targetURL - mdx:// URI
     */
    async handleClick(targetURL) {
        const folderId = targetURL.pathname.substring(1);
        const folder = this.sessionService.findItemById(folderId);

        if (folder) {
            // 在实际应用中，你可能希望在会话列表中展开此文件夹。
            // dispatch 一个 action 到 store 来处理。
            this.sessionService.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId } });
            console.log(`[SessionDirProvider] Toggled folder: "${folder.metadata.title}".`);
        }
    }
    
    // TODO 注意：此 Provider 不支持文件夹的内容嵌入或无头数据处理。
}
