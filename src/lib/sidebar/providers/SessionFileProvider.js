// #sidebar/providers/SessionFileProvider.js

import { IMentionProvider } from '../../common/interfaces/IMentionProvider.js';
import {escapeHTML} from '../../common/utils/utils.js';
/**
 * @class
 * @implements {IMentionProvider}
 * 为 sessionUI 中的会话（文件）提供 @mention 风格的自动完成和交互功能。
 * 它还支持内容嵌入和为 mdxprocess 提供数据。
 */
export class SessionFileProvider extends IMentionProvider {
    /**
     * 对应于 mdx://file/session-id URI 格式。
     * @type {string}
     */
    key = 'file';

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
            throw new Error("SessionFileProvider requires an ISessionService instance.");
        }
        this.sessionService = sessionService;
    }

    // --- [修复] ---
    // 删除了内部的 _getAllFiles 辅助方法。
    // 这个职责现在已经正确地移交给了 SessionService。

    /**
     * 根据查询字符串获取会话建议。
     * @param {string} query - 用户在 '@file:' 后输入的搜索字符串。
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        // --- [修复] ---
        // 不再直接访问 store (this.sessionService.store.getState())，
        // 而是调用 SessionService 提供的标准公共接口，恢复了封装性。
        const allFiles = await this.sessionService.getAllFiles();
        const lowerQuery = query.toLowerCase();

        return allFiles
            // [MODIFIED] Access title from metadata
            .filter(file => file.metadata.title.toLowerCase().includes(lowerQuery))
            .map(file => ({
                id: file.id,
                // [MODIFIED] Access title from metadata
                label: `📄 ${file.metadata.title}` 
            }));
    }

    /**
     * 为悬停的链接提供预览内容。
     * @param {URL} targetURL - mdx:// URI
     * @returns {Promise<{title: string, contentHTML: string, icon: string} | null>}
     */
    async getHoverPreview(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const file = this.sessionService.findItemById(fileId);

        if (file && file.type === 'item') {
            // [MODIFIED] Access summary from content object
            const summary = file.content?.summary || (file.content?.data ? String(file.content.data).substring(0, 100) + '...' : '无内容。');
            return {
                // [MODIFIED] Access title from metadata
                title: file.metadata.title,
                contentHTML: `<p><em>${escapeHTML(summary)}</em></p>`,
                icon: '📄'
            };
        }
        return null;
    }

    /**
     * 处理对会话链接的点击事件，这将选中该会话。
     * @param {URL} targetURL - mdx:// URI
     */
    async handleClick(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        // 这将选中会话并触发 UI 更新
        this.sessionService.selectSession(fileId);
    }

    /**
     * 为内容嵌入（transclusion）提供 Markdown 内容。
     * @param {URL} targetURL - mdx:// URI
     * @returns {Promise<string | null>}
     */
    async getContentForTransclusion(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const file = this.sessionService.findItemById(fileId);
        // [MODIFIED] Access the raw data from content.data
        return (file && file.type === 'item') ? file.content?.data : null;
    }

    /**
     * 为无头处理（如 mdxprocess）提供原始数据。
     * 这满足了在 `mdxprocess` 中展开信息的需求。
     * @param {URL} targetURL - mdx:// URI
     * @returns {Promise<object | null>}
     */
    async getDataForProcess(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const fileData = this.sessionService.findItemById(fileId);
        if (fileData && fileData.type === 'item') {
            return {
                id: fileData.id,
                // [MODIFIED] Access data from the correct locations
                title: fileData.metadata.title,
                content: fileData.content?.data,
                tags: fileData.metadata.tags
            };
        }
        return null;
    }
}
