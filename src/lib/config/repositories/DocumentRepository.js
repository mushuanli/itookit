// #config/repositories/DocumentRepository.js

import { generateUUID } from '../../common/utils/utils.js';

/**
 * @fileoverview Manages all document content, decoupled from the file system structure.
 * @description This is a singleton repository that acts as the single source of truth for all documents
 * across all modules. It handles content storage, metadata, and bidirectional linking.
 */
export class DocumentRepository {
  /**
   * @param {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} persistenceAdapter
   * @param {import('../EventManager.js').EventManager} eventManager
   */
  constructor(persistenceAdapter, eventManager) {
    this.adapter = persistenceAdapter;
    this.eventManager = eventManager;
    /** @private @type {Map<string, import('../shared/types.js').Document>} */
    this.documents = new Map();
    this.storageKey = 'documents_store'; // Global storage key
    this._loadingPromise = null;
  }

  load() {
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = (async () => {
      const data = await this.adapter.getItem(this.storageKey) || {};
      this.documents = new Map(Object.entries(data));
      return this.documents;
    })();
    return this._loadingPromise;
  }

  async _save() {
    const data = Object.fromEntries(this.documents);
    await this.adapter.setItem(this.storageKey, data);
  }

  // ===== Core CRUD =====

  async createDocument(docData) {
    await this.load();
    const id = generateUUID();
    const now = new Date().toISOString();
    
    /** @type {import('../shared/types.js').Document} */
    const newDoc = {
      ...docData,
      id,
      metadata: {
        tags: [],
        ...docData.metadata,
        createdAt: now,
        modifiedAt: now,
      },
      references: { outgoing: [], incoming: [] },
    };

    this.documents.set(id, newDoc);
    await this._updateReferences(newDoc);
    await this._save();
    
    this.eventManager.publish('document:created', newDoc);
    return newDoc;
  }

  async updateContent(docId, newContent, metadataUpdates = {}) {
    await this.load();
    const doc = this.documents.get(docId);
    if (!doc) throw new Error(`Document ${docId} not found`);

    doc.content = newContent;
    doc.metadata.modifiedAt = new Date().toISOString();
    
    Object.assign(doc.metadata, metadataUpdates);
    
    await this._updateReferences(doc);
    await this._save();
    this.eventManager.publish('document:updated', doc);
    return doc;
  }
  
  // ===== Query Methods =====

  async getById(id) {
    await this.load();
    return this.documents.get(id);
  }

  async getByModule(moduleId) {
    await this.load();
    return Array.from(this.documents.values()).filter(doc => doc.moduleId === moduleId);
  }
  
  // ===== Reference Management =====

  /** @private */
  async _updateReferences(doc) {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const newOutgoing = new Set();
    
    let match;
    while ((match = linkRegex.exec(doc.content)) !== null) {
      const linkedDocId = this._resolveLink(match[1]);
      if (linkedDocId) newOutgoing.add(linkedDocId);
    }

    const oldOutgoing = new Set(doc.references.outgoing);
    
    for (const oldId of oldOutgoing) {
      if (!newOutgoing.has(oldId)) {
        const linkedDoc = this.documents.get(oldId);
        if (linkedDoc) {
          linkedDoc.references.incoming = linkedDoc.references.incoming.filter(id => id !== doc.id);
        }
      }
    }
    
    for (const newId of newOutgoing) {
      if (!oldOutgoing.has(newId)) {
        const linkedDoc = this.documents.get(newId);
        if (linkedDoc && !linkedDoc.references.incoming.includes(doc.id)) {
          linkedDoc.references.incoming.push(doc.id);
        }
      }
    }
    
    doc.references.outgoing = Array.from(newOutgoing);
  }

  /** @private */
  _resolveLink(linkText) {
    // Simplified link resolver. A robust system would use an index.
    for (const doc of this.documents.values()) {
        if (doc.metadata.title === linkText) {
            return doc.id;
        }
    }
    return undefined;
  }
}
