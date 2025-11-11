/**
 * @file vfsCore/registry/ModuleRegistry.js
 * @fileoverview ModuleRegistry - 模块（命名空间）注册表
 */

export class ModuleInfo {
    constructor(name, options = {}) {
        this.name = name;
        this.rootId = options.rootId || null;
        this.description = options.description || '';
        this.createdAt = options.createdAt || new Date();
        this.meta = options.meta || {};
    }
    
    toJSON() {
        return {
            name: this.name,
            rootId: this.rootId,
            description: this.description,
            createdAt: this.createdAt,
            meta: this.meta
        };
    }
    
    static fromJSON(data) {
        return new ModuleInfo(data.name, data);
    }
}

export class ModuleRegistry {
    constructor() {
        /** @type {Map<string, ModuleInfo>} */
        this.modules = new Map();
    }
    
    /**
     * 注册模块
     * @param {string} name
     * @param {object} [options={}]
     * @returns {ModuleInfo}
     */
    register(name, options = {}) {
        // [修改] 放宽限制，允许在初始化时覆盖
        if (this.modules.has(name)) {
            // 在加载阶段，模块可能被重复注册（从存储加载一次，然后作为默认模块检查一次），这是正常行为。
            // 我们可以选择静默更新或打印一条警告。
            console.warn(`[ModuleRegistry] Module '${name}' is being re-registered. This is expected during initialization.`);
        }
        
        const moduleInfo = new ModuleInfo(name, options);
        this.modules.set(name, moduleInfo);
        console.log(`[ModuleRegistry] Registered module: ${name}`);
        
        return moduleInfo;
    }
    
    /**
     * 注销模块
     * @param {string} name
     */
    unregister(name) {
        if (this.modules.delete(name)) {
            console.log(`[ModuleRegistry] Unregistered module: ${name}`);
        }
    }
    
    /**
     * 获取模块信息
     * @param {string} name
     * @returns {ModuleInfo|undefined}
     */
    get(name) {
        return this.modules.get(name);
    }
    
    /**
     * 检查模块是否存在
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this.modules.has(name);
    }
    
    /**
     * 获取所有模块名称
     * @returns {string[]}
     */
    getModuleNames() {
        return Array.from(this.modules.keys());
    }
    
    /**
     * 更新模块信息
     * @param {string} name
     * @param {object} updates
     */
    update(name, updates) {
        const module = this.modules.get(name);
        if (!module) {
            throw new Error(`Module '${name}' not found`);
        }
        
        Object.assign(module, updates);
    }
}
