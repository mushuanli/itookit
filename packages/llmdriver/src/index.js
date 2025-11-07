/**
 * @file src/index.js
 * @description Main public API entry point for the @itookit/llmdriver library.
 */

// --- Core Classes ---
// Primary entry points for using the library.
export { LLMDriver } from './client.js';
export { LLMChain } from './chain.js';

// --- Standalone Utilities ---
// Useful functions that can be used independently.
export { testLLMConnection } from './api.js';
export { processAttachment } from './utils/file-processor.js';

// --- Errors & Interfaces ---
// For advanced usage, type checking, and custom extensions.
export { LLMError } from './errors.js';
export { IFileStorageAdapter } from './mime/IFileStorageAdapter.js';
export { FileStorageAdapter } from './mime/FileStorageAdapter.js';
export { BaseProvider } from './providers/base.js';