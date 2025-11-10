/**
 * @file vfs-ui/providers/FileProvider.js
 */
import { IMentionProvider,escapeHTML } from '@itookit/common';

/**
 * @class
 * @implements {IMentionProvider}
 * Provides @mention style autocompletion and interaction for files in VFS-UI.
 */
export class FileProvider extends IMentionProvider {
    /**
     * Corresponds to the vfs://file/node-id URI format.
     * @type {string}
     */
    key = 'file';

    /**
     * The character that triggers this provider.
     * @type {string}
     */
    triggerChar = '@';

    /**
     * @param {object} dependencies
     * @param {import('../services/VFSService.js').VFSService} dependencies.vfsService
     */
    constructor({ vfsService }) {
        super();
        if (!vfsService) {
            throw new Error("FileProvider requires a VFSService instance.");
        }
        this.vfsService = vfsService;
    }

    /**
     * Provides file suggestions based on a query string.
     * @param {string} query - The search string entered by the user after '@file:'.
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        const allFiles = await this.vfsService.getAllFiles();
        const lowerQuery = query.toLowerCase();

        return allFiles
            .filter(file => file.metadata.title.toLowerCase().includes(lowerQuery))
            .map(file => ({
                id: file.id,
                label: `📄 ${file.metadata.title}`
            }));
    }

    /**
     * Provides a preview for a hovered link.
     * @param {URL} targetURL - The vfs:// URI.
     * @returns {Promise<{title: string, contentHTML: string, icon: string} | null>}
     */
    async getHoverPreview(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const file = this.vfsService.findItemById(fileId);

        if (file && file.type === 'file') {
            const summary = file.content?.summary || (file.content?.data ? String(file.content.data).substring(0, 100) + '...' : '无内容。');
            return {
                title: file.metadata.title,
                contentHTML: `<p><em>${escapeHTML(summary)}</em></p>`,
                icon: '📄'
            };
        }
        return null;
    }

    /**
     * Handles clicks on a file link, which selects it in the UI.
     * @param {URL} targetURL - The vfs:// URI.
     */
    async handleClick(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        this.vfsService.selectSession(fileId);
    }

    /**
     * Provides content for transclusion.
     * @param {URL} targetURL - The vfs:// URI.
     * @returns {Promise<string | null>}
     */
    async getContentForTransclusion(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const file = this.vfsService.findItemById(fileId);
        // This is a simplified version. A real implementation would fetch from vfs-core.
        // const { content } = await this.vfsService.vfsCore.read(fileId);
        // return content;
        return (file && file.type === 'file') ? file.content?.data : null;
    }

    /**
     * Provides raw data for headless processing.
     * @param {URL} targetURL - The vfs:// URI.
     * @returns {Promise<object | null>}
     */
    async getDataForProcess(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        const fileData = this.vfsService.findItemById(fileId);
        if (fileData && fileData.type === 'file') {
            return {
                id: fileData.id,
                title: fileData.metadata.title,
                content: fileData.content?.data,
                tags: fileData.metadata.tags
            };
        }
        return null;
    }
}