// #configManager/repositories/TaskRepository.js

/**
 * @fileoverview 负责 Task (任务) 数据的持久化和查询。
 * 包括从文件内容中解析任务，以及按用户、按时间范围查询任务。
 */
import { STORES } from '../constants.js';
import { generateShortUUID } from '@itookit/common';
import { NotFoundError } from '../utils/errors.js';

export class TaskRepository {
    constructor(db, eventManager) {
        this.db = db;
        this.events = eventManager;
    }

    /**
     * 【改进】支持传入事务
     */
    async reconcileTasks(nodeId, content, transaction = null) {
        const taskRegex = /(-\s*\[([ xX])\]\s*@(\S+)\s*\[(\d{4}-\d{2}-\d{2})(?:\s*to\s*(\d{4}-\d{2}-\d{2}))?\]\s*(.*?))(\s*\^task-([a-z0-9-]+))?$/gm;
        
        const tx = transaction || await this.db.getTransaction(STORES.TASKS, 'readwrite');
        const store = tx.objectStore(STORES.TASKS);
        
        const lines = content.split('\n');
        const newLines = [];
        const foundTaskIds = new Set();
        const reconciledTasks = [];

        for (const line of lines) {
            taskRegex.lastIndex = 0;
            let newLine = line;
            const match = taskRegex.exec(line);
            
            if (match) {
                const [fullMatch, mainLine, check, userId, startTime, endTime, description, idBlock, existingId] = match;
                
                let taskId = existingId ? `task-${existingId}` : `task-${generateShortUUID()}`;
                
                if (!existingId) {
                    newLine = `${mainLine.trim()} ^${taskId}`;
                }
                
                const task = {
                    id: taskId,
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

        const index = store.index('by_nodeId');
        const oldTasks = await new Promise(r => index.getAll(nodeId).onsuccess = e => r(e.target.result));

        for (const oldTask of oldTasks) {
            if (!foundTaskIds.has(oldTask.id)) {
                await store.delete(oldTask.id);
            }
        }
        
        for (const task of reconciledTasks) {
            await store.put(task);
        }

        return {
            updatedContent: newLines.join('\n'),
            tasks: reconciledTasks
        };
    }

    async findByUser(userId) {
        return this.db.getAllByIndex(STORES.TASKS, 'by_userId', userId);
    }

    async findByDateRange(startDate, endDate) {
        const range = IDBKeyRange.bound(startDate, endDate);
        return this.db.getAllByIndex(STORES.TASKS, 'by_startTime', range);
    }

    async updateTaskStatus(taskId, newStatus) {
        const tx = await this.db.getTransaction(STORES.TASKS, 'readwrite');
        const store = tx.objectStore(STORES.TASKS);
        const task = await new Promise((resolve, reject) => {
            const request = store.get(taskId);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });

        if (!task) {
            throw new NotFoundError(`Task with id ${taskId} not found`);
        }

        task.status = newStatus;
        await store.put(task);
        return task;
    }
}
