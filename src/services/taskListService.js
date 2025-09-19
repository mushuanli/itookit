// src/services/taskListService.js
import { db } from '../common/db.js';
import { generateId } from '../common/utils.js';

export const UNCATEGORIZED_ID = 'uncategorized';

/**
 * 确保默认的“未分类”列表存在于数据库中。
 * 应用启动时应调用此方法。
 */
export async function initializeDefaultTaskList() {
    try {
        const uncategorized = await db.global_taskLists.get(UNCATEGORIZED_ID);
        if (!uncategorized) {
            await db.global_taskLists.put({ id: UNCATEGORIZED_ID, name: '未分类' });
        }
    } catch (error) {
        console.error("Failed to initialize default task list:", error);
    }
}

/**
 * 获取所有任务列表。
 * @returns {Promise<Array>}
 */
export async function getAllTaskLists() {
    try {
        return await db.global_taskLists.toArray();
    } catch (error) {
        console.error("Failed to get all task lists:", error);
        return [];
    }
}

/**
 * 添加一个新的任务列表。
 * @param {string} name - 新列表的名称。
 * @returns {Promise<object>} 新创建的列表对象。
 */
export async function addTaskList(name) {
    const newId = generateId();
    const newList = { id: newId, name: name.trim() };
    await db.global_taskLists.add(newList);
    return newList;
}

/**
 * 重命名一个任务列表。
 * @param {string} id - 列表的ID。
 * @param {string} newName - 新的名称。
 */
export async function renameTaskList(id, newName) {
    if (id === UNCATEGORIZED_ID) {
        throw new Error("无法重命名默认的“未分类”列表。");
    }
    const trimmedName = newName.trim();
    const existing = await db.global_taskLists.where('name').equals(trimmedName).first();
    if (existing && existing.id !== id) {
        throw new Error(`名称 "${trimmedName}" 已存在。`);
    }
    await db.global_taskLists.update(id, { name: trimmedName });
}

/**
 * 删除一个任务列表。
 * 属于此列表的所有任务将被移动到“未分类”列表。
 * @param {string} id - 要删除的列表ID。
 */
export async function deleteTaskList(id) {
    if (id === UNCATEGORIZED_ID) {
        throw new Error("无法删除默认的“未分类”列表。");
    }
    await db.transaction('rw', db.global_taskLists, db.task_tasks, async () => {
        const tasksToMove = await db.task_tasks.where('listId').equals(id).primaryKeys();
        if (tasksToMove.length > 0) {
            await db.task_tasks.where('uuid').anyOf(tasksToMove).modify({ listId: UNCATEGORIZED_ID });
        }
        await db.global_taskLists.delete(id);
    });
}
