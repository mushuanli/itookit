// #sidebar/index.js

/**
 * @file Public API entry point for the SessionUI library.
 */
import './index.css';

import { SessionUIManager } from './core/SessionUIManager.js';
import { SessionDirProvider } from './providers/SessionDirProvider.js';
import { SessionFileProvider } from './providers/SessionFileProvider.js';
import { SessionTagProvider } from './providers/SessionTagProvider.js';

/**
 * Initializes and returns a new instance of the SessionUI manager.
 * This is the primary factory function for the library.
 *
 * @param {import('./core/SessionUIManager.js').SessionUIOptions} options - Configuration options.
 * @returns {import('../../common/interfaces/ISessionManager.js').ISessionManager} A new instance conforming to the ISessionManager interface.
 */
export function createSessionUI(options) {
    return new SessionUIManager(options);
}

// For convenience, we can also export the main class itself and the new providers.
export {
    SessionUIManager,
    SessionDirProvider,
    SessionFileProvider,
    SessionTagProvider,
};