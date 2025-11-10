/**
 * @file vfs-ui/providers/DirectoryProvider.js
 */
import { IMentionProvider } from '@itookit/common';

/**
 * @class
 * @implements {IMentionProvider}
 * Provides @mention style autocompletion and interaction for directories (folders) in VFS-UI.
 * It retrieves data from the VFSService.
 */
export class DirectoryProvider extends IMentionProvider {
    /**
     * Corresponds to the vfs://dir/folder-id URI format.
     * @type {string}
     */
    key = 'dir';

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
            throw new Error("DirectoryProvider requires a VFSService instance.");
        }
        this.vfsService = vfsService;
    }

    /**
     * Retrieves all directories from the service.
     * @returns {Promise<import('../types/types.js')._VFSNodeUI[]>}
     */
    async getAllDirectories() {
        return this.vfsService.getAllFolders(); // VFSService uses 'getAllFolders' for now
    }

    /**
     * Provides directory suggestions based on a query string.
     * @param {string} query - The search string entered by the user after '@dir:'.
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        const allDirs = await this.getAllDirectories();
        const lowerQuery = query.toLowerCase();

        return allDirs
            .filter(dir => dir.metadata.title.toLowerCase().includes(lowerQuery))
            .map(dir => ({
                id: dir.id,
                label: `📁 ${dir.metadata.title}`
            }));
    }

    /**
     * Provides a preview for a hovered link.
     * @param {URL} targetURL - The vfs:// URI.
     * @returns {Promise<{title: string, contentHTML: string, icon: string} | null>}
     */
    async getHoverPreview(targetURL) {
        const dirId = targetURL.pathname.substring(1); // Remove leading '/'
        const directory = this.vfsService.findItemById(dirId);
        if (directory?.type === 'directory') {
            const childCount = directory.children?.length || 0;
            return {
                title: directory.metadata.title,
                contentHTML: `<p>包含 ${childCount} 个项目。</p>`,
                icon: '📁'
            };
        }
        return null;
    }

    /**
     * Handles clicks on a directory link.
     * @param {URL} targetURL - The vfs:// URI.
     */
    async handleClick(targetURL) {
        const dirId = targetURL.pathname.substring(1);
        const directory = this.vfsService.findItemById(dirId);

        if (directory) {
            // Toggles the expansion state of the directory in the UI
            this.vfsService.store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: dirId } });
            console.log(`[DirectoryProvider] Toggled directory: "${directory.metadata.title}".`);
        }
    }
}
