// #common/utils/UnifiedID.js

/**
 * @fileoverview 统一ID生成器，确保全系统ID格式的一致性和可读性。
 */
export class UnifiedID {
    static _generate(prefix) {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 11);
        return `${prefix}-${timestamp}-${random}`;
    }

    /**
     * 生成一个文档ID. e.g., 'doc-kxvz123-abcde123'
     * @returns {string}
     */
    static document() { return this._generate('doc'); }

    /**
     * 生成一个文件系统节点ID. e.g., 'fsn-kxvz123-abcde123'
     * @returns {string}
     */
    static fsNode() { return this._generate('fsn'); }

    /**
     * 生成一个Cloze卡片ID. e.g., 'clz-kxvz123-abcde123'
     * @returns {string}
     */
    static cloze() { return this._generate('clz'); }
}
