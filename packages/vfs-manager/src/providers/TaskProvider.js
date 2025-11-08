/**
 * @file vfsManager/providers/TaskProvider.js
 * @fileoverview TaskProvider - 任务管理内容提供者
 * 处理 - [ ] @user [date] Task 格式的任务
 */

import { ContentProvider } from './base/ContentProvider.js';
import { VFS_STORES } from '../storage/VFSStorage.js';
import { ProviderError } from '../core/VFSError.js';

export class TaskProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('task', {
            priority: 8,
            capabilities: ['task-management', 'mentions', 'due-dates']
        });
        
        this.storage = storage;
        this.events = eventBus;
        
        // 任务正则：- [ ] @user [2024-01-01] Task text ^task-id
        this.taskRegex = /^(\s*)- \[([ xX])\]\s*(?:@([\w-]+))?\s*(?:\[([^\]]+)\])?\s*(.+?)(?:\s*\^(task-[a-z0-9-]+))?$/gm;
    }
    
    /**
     * 读取任务内容，附加任务元数据
     */
    async read(vnode, options = {}) {
        const tasks = await this._getTasks(vnode.id);
        
        return {
            content: null,
            metadata: {
                tasks: tasks.map(t => ({
                    id: t.id,
                    content: t.content,
                    completed: t.completed,
                    assignee: t.assignee,
                    dueDate: t.dueDate,
                    priority: t.priority,
                    tags: t.tags
                })),
                totalTasks: tasks.length,
                completedTasks: tasks.filter(t => t.completed).length,
                pendingTasks: tasks.filter(t => !t.completed).length,
                overdueTasks: tasks.filter(t => 
                    !t.completed && t.dueDate && new Date(t.dueDate) < new Date()
                ).length
            }
        };
    }
    
    /**
     * 写入任务内容，解析并协调任务
     */
    async write(vnode, content, transaction) {
        try {
            const store = transaction.getStore(VFS_STORES.TASKS);
            
            // 1. 解析任务
            const { updatedContent, tasks } = await this._parseTasks(
                vnode.id,
                content,
                store
            );
            
            // 2. 获取现有任务
            const existingTasks = await this._getTasks(vnode.id, transaction);
            const existingIds = new Set(existingTasks.map(t => t.id));
            const foundIds = new Set(tasks.map(t => t.id));
            
            // 3. 删除已移除的任务
            const removedIds = [...existingIds].filter(id => !foundIds.has(id));
            for (const id of removedIds) {
                await this._deleteTask(id, store);
            }
            
            // 4. 保存/更新任务
            for (const task of tasks) {
                await this._saveTask(task, store);
            }
            
            // 5. 发布事件
            if (tasks.length > 0 || removedIds.length > 0) {
                this.events.emit('tasks:updated', {
                    nodeId: vnode.id,
                    added: tasks.filter(t => !existingIds.has(t.id)).length,
                    updated: tasks.filter(t => existingIds.has(t.id)).length,
                    removed: removedIds.length
                });
            }
            
            return {
                updatedContent,
                derivedData: {
                    tasks: tasks.map(t => ({
                        id: t.id,
                        content: t.content,
                        completed: t.completed,
                        assignee: t.assignee,
                        dueDate: t.dueDate
                    })),
                    stats: {
                        total: tasks.length,
                        completed: tasks.filter(t => t.completed).length,
                        pending: tasks.filter(t => !t.completed).length
                    }
                }
            };
            
        } catch (error) {
            throw new ProviderError('task', `Failed to process tasks: ${error.message}`);
        }
    }
    
    /**
     * 验证任务内容
     */
    async validate(vnode, content) {
        const errors = [];
        
        // 检查日期格式
        const dateRegex = /\[(\d{4}-\d{2}-\d{2})\]/g;
        let match;
        
        while ((match = dateRegex.exec(content)) !== null) {
            const dateStr = match[1];
            const date = new Date(dateStr);
            
            if (isNaN(date.getTime())) {
                errors.push(`Invalid date format: ${dateStr}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * 清理节点的所有任务
     */
    async cleanup(vnode, transaction) {
        const store = transaction.getStore(VFS_STORES.TASKS);
        const index = store.index('by_nodeId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(vnode.id));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    this.events.emit('tasks:deleted', { nodeId: vnode.id });
                    resolve();
                }
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 获取任务统计信息
     */
    async getStats(vnode) {
        const tasks = await this._getTasks(vnode.id);
        const now = new Date();
        
        return {
            total: tasks.length,
            completed: tasks.filter(t => t.completed).length,
            pending: tasks.filter(t => !t.completed).length,
            overdue: tasks.filter(t => 
                !t.completed && t.dueDate && new Date(t.dueDate) < now
            ).length,
            byAssignee: this._groupByAssignee(tasks)
        };
    }
    
    /**
     * 处理节点移动
     */
    async onMove(vnode, oldPath, newPath, transaction) {
        // 任务路径引用可能需要更新
        const tasks = await this._getTasks(vnode.id, transaction);
        const store = transaction.getStore(VFS_STORES.TASKS);
        
        for (const task of tasks) {
            // 更新任务的路径信息（如果有）
            if (task.meta && task.meta.path === oldPath) {
                task.meta.path = newPath;
                await this._saveTask(task, store);
            }
        }
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 解析内容中的任务
     */
    async _parseTasks(nodeId, content, store) {
        const lines = content.split('\n');
        const tasks = [];
        let updatedLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            this.taskRegex.lastIndex = 0;
            const match = this.taskRegex.exec(line);
            
            if (match) {
                const [fullMatch, indent, checkbox, assignee, dueDate, taskContent, existingId] = match;
                
                // 生成或复用 ID
                const taskId = existingId || `task-${this._generateShortId()}`;
                
                // 获取或创建任务
                const existingTask = await this._getTaskById(taskId, store);
                
                const task = {
                    id: taskId,
                    nodeId,
                    content: taskContent.trim(),
                    completed: checkbox.toLowerCase() === 'x',
                    assignee: assignee || null,
                    dueDate: dueDate ? new Date(dueDate) : null,
                    priority: this._extractPriority(taskContent),
                    tags: this._extractTags(taskContent),
                    lineNumber: i + 1,
                    indent: indent.length,
                    createdAt: existingTask?.createdAt || new Date(),
                    updatedAt: new Date(),
                    completedAt: checkbox.toLowerCase() === 'x' 
                        ? (existingTask?.completedAt || new Date())
                        : null
                };
                
                tasks.push(task);
                
                // 重构任务行（确保有 ID）
                let newLine = `${indent}- [${checkbox}]`;
                if (assignee) newLine += ` @${assignee}`;
                if (dueDate) newLine += ` [${dueDate}]`;
                newLine += ` ${taskContent}`;
                if (!existingId) newLine += ` ^${taskId}`;
                
                updatedLines.push(newLine);
            } else {
                updatedLines.push(line);
            }
        }
        
        return {
            updatedContent: updatedLines.join('\n'),
            tasks
        };
    }
    
    /**
     * 获取节点的所有任务
     */
    async _getTasks(nodeId, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(VFS_STORES.TASKS);
            const index = store.index('by_nodeId');
            
            return new Promise((resolve, reject) => {
                const request = index.getAll(nodeId);
                request.onsuccess = (e) => resolve(e.target.result || []);
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        return this.storage.db.getAllByIndex(
            VFS_STORES.TASKS,
            'by_nodeId',
            nodeId
        );
    }
    
    /**
     * 根据 ID 获取任务
     */
    async _getTaskById(taskId, store) {
        return new Promise((resolve) => {
            const request = store.get(taskId);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    }
    
    /**
     * 保存任务
     */
    async _saveTask(task, store) {
        return new Promise((resolve, reject) => {
            const request = store.put(task);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 删除任务
     */
    async _deleteTask(taskId, store) {
        return new Promise((resolve, reject) => {
            const request = store.delete(taskId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 提取优先级
     */
    _extractPriority(content) {
        if (content.includes('🔴') || content.includes('!!!')) return 'high';
        if (content.includes('🟡') || content.includes('!!')) return 'medium';
        return 'normal';
    }
    
    /**
     * 提取标签
     */
    _extractTags(content) {
        const tagRegex = /#([\w-]+)/g;
        const tags = [];
        let match;
        
        while ((match = tagRegex.exec(content)) !== null) {
            tags.push(match[1]);
        }
        
        return tags;
    }
    
    /**
     * 按指派人分组
     */
    _groupByAssignee(tasks) {
        const grouped = {};
        
        for (const task of tasks) {
            const assignee = task.assignee || 'unassigned';
            if (!grouped[assignee]) {
                grouped[assignee] = { total: 0, completed: 0, pending: 0 };
            }
            grouped[assignee].total++;
            if (task.completed) {
                grouped[assignee].completed++;
            } else {
                grouped[assignee].pending++;
            }
        }
        
        return grouped;
    }
    
    /**
     * 生成短 ID
     */
    _generateShortId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
