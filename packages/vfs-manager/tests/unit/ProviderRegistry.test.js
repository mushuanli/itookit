// @file tests/unit/ProviderRegistry.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../src/registry/ProviderRegistry.js';
import { ContentProvider } from '../../src/providers/base/ContentProvider.js';

class TestProvider extends ContentProvider {
    constructor() {
        super('test', { priority: 10 });
    }
    
    async read(vnode) {
        return { content: 'test', metadata: {} };
    }
    
    async write(vnode, content, tx) {
        return { updatedContent: content, derivedData: {} };
    }
}

describe('ProviderRegistry', () => {
    let registry;
    
    beforeEach(() => {
        registry = new ProviderRegistry();
    });
    
    it('should register provider', () => {
        const provider = new TestProvider();
        registry.register(provider);
        
        expect(registry.has('test')).toBe(true);
        expect(registry.get('test')).toBe(provider);
    });
    
    it('should map content types', () => {
        registry.mapType('markdown', ['plain', 'link']);
        
        const providers = registry.getDefaultProviders('markdown');
        expect(providers).toEqual(['plain', 'link']);
    });
    
    it('should sort providers by priority', () => {
        const provider1 = new ContentProvider('p1', { priority: 5 });
        const provider2 = new ContentProvider('p2', { priority: 10 });
        
        registry.register(provider1);
        registry.register(provider2);
        
        const vnode = {
            providers: ['p1', 'p2']
        };
        
        const sorted = registry.getProvidersForNode(vnode);
        expect(sorted[0].name).toBe('p2'); // 高优先级在前
    });
});
