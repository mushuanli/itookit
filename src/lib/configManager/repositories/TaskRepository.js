// #configManager/repositories/TaskRepository.js

/**
 * @fileoverview 负责 Task (任务) 数据的持久化和查询。
 * 包括从文件内容中解析任务，以及按用户、按时间范围查询任务。
 */
import { STORES } from '../constants.js';
import { generateShortUUID } from '../../common/utils/utils.js';

export class TaskRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db) {
        this.db = db;
    }

        /**
     * 从文件内容中解析并更新任务。
     * 这是一个幂等操作：它会先删除该文件所有旧任务，然后添加所有新任务。
     * @param {string} nodeId - 所属文件ID
     * @param {string} content - 文件内容
     * @returns {Promise<void>}
     *
     * 任务格式示例 (可自定义):
     * - [ ] @alice [2024-01-01 to 2024-01-05] 设计数据库模型。
     * - [x] @bob [2024-01-02] 完成API文档。
     */
    /**
     * Reconciles tasks from content: finds existing tasks, creates new ones with stable IDs,
     * updates the database, and returns the potentially modified content.
     * @param {string} nodeId - The parent node's ID.
     * @param {string} content - The markdown content.
     * @returns {Promise<{updatedContent: string, tasks: object[]}>} - An object containing the modified content and the list of reconciled tasks.
     */
    async reconcileTasks(nodeId, content) {
        // Regex updated to optionally capture an existing block ID.
        // It now captures the main task line separately from the optional ID.
        const taskRegex = /(-\s*\[([ xX])\]\s*@(\S+)\s*\[(\d{4}-\d{2}-\d{2})(?:\s*to\s*(\d{4}-\d{2}-\d{2}))?\]\s*(.*?))(\s*\^task-([a-z0-9-]+))?$/gm;
        
        const tx = await this.db.getTransaction(STORES.TASKS, 'readwrite');
        const store = tx.objectStore(STORES.TASKS);
        
        const lines = content.split('\n');
        const newLines = [];
        const foundTaskIds = new Set();
        const reconciledTasks = [];

        for (const line of lines) {
            // We need to reset the regex index for each line since we are not using a global match on the whole content at once
            taskRegex.lastIndex = 0; 
            let newLine = line;
            const match = taskRegex.exec(line);
            
            if (match) {
                const [fullMatch, mainLine, check, userId, startTime, endTime, description, idBlock, existingId] = match;
                
                let taskId = existingId ? `task-${existingId}` : `task-${generateShortUUID()}`;
                
                // If the ID was newly generated, append it to the line.
                if (!existingId) {
                    newLine = `${mainLine.trim()} ^${taskId}`;
                }
                
                const task = {
                    id: taskId, // This is now the primary key.
                    nodeId,
                    userId: userId.trim(),
                    startTime: new Date(startTime),
                    endTime: endTime ? new Date(endTime) : new Date(startTime),
                    description: description.trim(),
                    status: check.trim().toLowerCase() === 'x' ? 'done' : 'todo',
                };
                
                reconciledTasks.push(task);
                foundTaskIds.add(task.id);
            }
            newLines.push(newLine);
        }

        // Now, update the database
        // 1. Get all old tasks for this node
        const index = store.index('by_nodeId');
        const oldTasks = await new Promise(r => index.getAll(nodeId).onsuccess = e => r(e.target.result));

        // 2. Delete tasks that are no longer in the content
        for (const oldTask of oldTasks) {
            if (!foundTaskIds.has(oldTask.id)) {
                await store.delete(oldTask.id);
            }
        }
        
        // 3. Put (add or update) all reconciled tasks
        for (const task of reconciledTasks) {
            await store.put(task);
        }

        return {
            updatedContent: newLines.join('\n'),
            tasks: reconciledTasks
        };
    }



    /**
     * 根据用户ID查找所有相关任务。
     * @param {string} userId
     * @returns {Promise<object[]>} 任务对象数组
     */
    async findByUser(userId) {
        return this.db.getAllByIndex(STORES.TASKS, 'by_userId', userId);
    }

    /**
     * 根据时间范围查找所有任务。
     * 【修改】在注释中明确指出查询逻辑是基于任务的`startTime`。
     * @param {Date} startDate - 开始日期
     * @param {Date} endDate - 结束日期
     * @returns {Promise<object[]>} 任务对象数组
     */
    async findByDateRange(startDate, endDate) {
        const range = IDBKeyRange.bound(startDate, endDate);
        return this.db.getAllByIndex(STORES.TASKS, 'by_startTime', range);
    }

    /**
     * 更新单个任务的状态。
     * @param {string} taskId - 任务的唯一ID
     * @param {'todo' | 'doing' | 'done'} newStatus - 新的状态
     * @returns {Promise<object>} 更新后的任务对象
     */
    async updateTaskStatus(taskId, newStatus) {
        const tx = await this.db.getTransaction(STORES.TASKS, 'readwrite');
        const store = tx.objectStore(STORES.TASKS);
        const task = await new Promise((resolve, reject) => { // [FIX] 添加 reject
            const request = store.get(taskId);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });

        if (!task) {
            throw new Error(`Task with id ${taskId} not found.`);
        }

        task.status = newStatus;
        await store.put(task);
        return task;
    }
}
