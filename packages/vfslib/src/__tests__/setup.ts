/**
 * Vitest global setup — polyfill IndexedDB for Node.js.
 * fake-indexeddb/auto installs:
 *   globalThis.indexedDB, IDBKeyRange, IDBFactory, IDBOpenDBRequest, etc.
 */
import 'fake-indexeddb/auto';
