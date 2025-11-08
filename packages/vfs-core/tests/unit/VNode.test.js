// @file vfsCore/tests/unit/VNode.test.js
import { describe, it, expect } from 'vitest';
import { VNode } from '../../src/core/VNode.js';

describe('VNode', () => {
    it('should create a file node', () => {
        const vnode = new VNode({
            type: 'file',
            module: 'notes',
            name: 'test.md',
            contentType: 'markdown'
        });
        
        expect(vnode.isFile()).toBe(true);
        expect(vnode.isDirectory()).toBe(false);
        expect(vnode.contentType).toBe('markdown');
    });
    
    it('should serialize and deserialize', () => {
        const vnode = new VNode({
            type: 'file',
            module: 'notes',
            name: 'test.md'
        });
        
        const json = vnode.toJSON();
        const restored = VNode.fromJSON(json);
        
        expect(restored.id).toBe(vnode.id);
        expect(restored.name).toBe(vnode.name);
    });
    
    it('should invalidate cache', () => {
        const vnode = new VNode({
            type: 'file',
            module: 'notes',
            name: 'test.md'
        });
        
        vnode._cached = true;
        vnode._content = 'test';
        vnode.invalidateCache();
        
        expect(vnode._cached).toBe(false);
        expect(vnode._content).toBe(null);
    });
});
