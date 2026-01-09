// @file packages/vfs-tags/src/schemas.ts

import { CollectionSchema } from '../core';

export const TAG_SCHEMAS: CollectionSchema[] = [
  {
    name: 'tags',
    keyPath: 'name',
    indexes: [
      { name: 'refCount', keyPath: 'refCount' },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]
  },
  {
    name: 'node_tags',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'nodeId', keyPath: 'nodeId' },
      { name: 'tagName', keyPath: 'tagName' },
      { name: 'nodeId_tagName', keyPath: ['nodeId', 'tagName'], unique: true }
    ]
  }
];
