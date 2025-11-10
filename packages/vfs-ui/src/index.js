/**
 * @file vfs-ui/index.js
 * @desc Public API entry point for the VFS-UI library.
 */
import './styles/vfs-ui.unified.css';

import { VFSUIManager } from './core/VFSUIManager.js';
import { DirectoryProvider } from './providers/DirectoryProvider.js';
import { FileProvider } from './providers/FileProvider.js';
import { TagProvider } from './providers/TagProvider.js';

/**
 * Creates a new VFS-UI instance to manage a specific module from vfs-core.
 *
 * @param {import('./core/VFSUIManager.js').VFSUIOptions} options - UI configuration options.
 * @param {import('@itookit/vfs-core').VFSCore} vfsCore - An initialized vfs-core instance.
 * @param {string} moduleName - The name of the vfs-core module this UI instance will manage.
 * @returns {import('@itookit/common').ISessionManager} A new manager instance conforming to the ISessionManager interface.
 */
export function createVFSUI(options, vfsCore, moduleName) {
    if (!vfsCore || !moduleName) {
        throw new Error("createVFSUI requires a valid vfs-core instance and a moduleName.");
    }
    // Pass all dependencies to the VFSUIManager constructor
    return new VFSUIManager(options, vfsCore, moduleName);
}

// For convenience, we also export the main class and providers.
export {
    VFSUIManager,
    DirectoryProvider,
    FileProvider,
    TagProvider,
};
