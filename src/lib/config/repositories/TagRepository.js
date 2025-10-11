// #config/repositories/TagRepository.js

import { STORAGE_KEYS, EVENTS } from '../shared/constants.js';

/**
 * @typedef {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} LocalStorageAdapter
 * @typedef {import('../EventManager.js').EventManager} EventManager
 * @typedef {import('../shared/types.js').Tag} Tag
 */

/**
 * @class TagRepository
 * @description 管理全局标签的整个生命周期，包括从持久化层加载、在内存中管理、
 * 保存更改，并在状态变更时通过事件通知应用程序的其他部分。
 * 它确保标签数据只从存储中加载一次，并以高效、安全的方式进行操作。
 */
export class TagRepository {
    /**
     * @param {LocalStorageAdapter} persistenceAdapter - 用于与浏览器存储交互的数据持久化适配器。
     * @param {EventManager} eventManager - 用于在应用内部发布更新事件的事件总线。
     */
    constructor(persistenceAdapter, eventManager) {
        if (!persistenceAdapter || !eventManager) {
            throw new Error("TagRepository requires a valid persistence adapter and event manager.");
        }
        this.adapter = persistenceAdapter;
        this.eventManager = eventManager;

        /** 
         * 使用 Set 来存储标签，以自动保证唯一性并提供高效的增删查操作。
         * @private 
         * @type {Set<Tag>} 
         */
        this.tags = new Set();

        /**
         * 一个Promise，它在首次数据加载完成时解析。
         * 这个机制用于防止对 `load()` 的并发调用导致多次从存储中读取数据，
         * 从而避免竞态条件并提高性能。
         * @private
         * @type {Promise<Tag[]> | null}
         */
        this._loadingPromise = null;
    }

    /**
     * 从持久化层加载标签数据。
     * 此方法是幂等的（idempotent）：它只在第一次被调用时执行实际的加载操作。
     * 后续的并发调用将直接返回第一次加载的Promise，确保数据只被加载一次。
     * @returns {Promise<Tag[]>} 一个解析为所有标签数组的Promise。
     */
    load() {
        if (this._loadingPromise) {
            return this._loadingPromise;
        }

        this._loadingPromise = (async () => {
            try {
                const storedTags = await this.adapter.getItem(STORAGE_KEYS.TAGS) || [];
                
                // 进行类型检查，防止存储中存有脏数据
                if (Array.isArray(storedTags)) {
                   this.tags = new Set(storedTags);
                } else {
                    console.warn("Stored tags data is corrupted. Initializing with an empty set.");
                    this.tags = new Set();
                }
                return this.getAll();
            } catch (error) {
                console.error("Failed to load tags from storage:", error);
                this.tags = new Set(); // 在加载失败时，重置为一个安全、空的状态
                return [];
            }
        })();

        return this._loadingPromise;
    }

    /**
     * 将当前内存中的标签集合持久化到存储中。
     * 这是一个内部方法，由公共的修改方法（如 addTag, removeTag）调用。
     * @private
     * @returns {Promise<void>}
     */
    async _save() {
        await this.adapter.setItem(STORAGE_KEYS.TAGS, Array.from(this.tags));
    }

    /**
     * 添加一个新标签。
     * 1. 验证输入是否为有效的非空字符串。
     * 2. 如果标签已存在，则静默忽略，不执行任何操作。
     * 3. 确保数据已加载，然后添加新标签。
     * 4. 持久化更改并发布全局更新事件。
     * @param {Tag} tag - 要添加的标签。
     * @returns {Promise<void>}
     */
    async addTag(tag) {
        if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
            console.warn("Attempted to add an invalid tag:", tag);
            return;
        }

        const trimmedTag = tag.trim();
        
        // 在修改前，必须确保初始数据已加载，防止覆盖未加载的数据。
        await this.load();

        if (this.tags.has(trimmedTag)) {
            return; // 标签已存在，无需任何操作。
        }

        this.tags.add(trimmedTag);
        await this._save();
        
        // 发布事件，通知所有监听者数据已更新。
        this.eventManager.publish(EVENTS.TAGS_UPDATED, this.getAll());
    }

    /**
     * 移除一个已存在的标签。
     * 1. 如果标签不存在，则静默忽略。
     * 2. 确保数据已加载，然后移除标签。
     * 3. 持久化更改并发布全局更新事件。
     * @param {Tag} tag - 要移除的标签。
     * @returns {Promise<void>}
     */
    async removeTag(tag) {
        // 在修改前，必须确保初始数据已加载。
        await this.load();

        if (!this.tags.has(tag)) {
            return; // 标签不存在，无需任何操作。
        }

        this.tags.delete(tag);
        await this._save();

        // 发布事件，通知所有监听者数据已更新。
        this.eventManager.publish(EVENTS.TAGS_UPDATED, this.getAll());
    }

    /**
     * 获取当前所有标签的快照。
     * @returns {Tag[]} 返回一个按字母顺序排序的标签数组。排序可以确保UI组件每次都以一致的顺序接收数据。
     */
    getAll() {
        // 返回数组副本，防止外部代码意外修改内部的 Set 状态。
        return Array.from(this.tags).sort();
    }
}
