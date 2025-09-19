// src/services/tagService.js
import { db } from '../common/db.js';

/**
 * 获取所有全局标签，并按字母排序
 * @returns {Promise<string[]>}
 */
export async function getAllTags() {
    try {
        const tags = await db.global_tags.toArray();
        return tags.map(tag => tag.name).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch (error) {
        console.error("Failed to get all tags:", error);
        return [];
    }
}

/**
 * 添加一个或多个新标签到全局列表。
 * @param {string | string[]} tags - 要添加的标签或标签数组
 */
export async function addTags(tags) {
    if (!tags || (Array.isArray(tags) && tags.length === 0)) {
        return;
    }
    try {
        const tagsToAdd = (Array.isArray(tags) ? tags : [tags])
            .filter(Boolean) // 过滤掉空字符串等无效值
            .map(name => ({ name: name.trim() }));
        
        if (tagsToAdd.length > 0) {
            // bulkPut 会智能地插入新标签，或忽略已存在的标签（因为 name 是主键）
            await db.global_tags.bulkPut(tagsToAdd);
        }
    } catch (error) {
        console.error("Failed to add tags:", error);
    }
}

/**
 * 从全局列表中删除一个标签。
 * 在删除前会检查该标签是否仍被任何任务或AI角色使用。
 * @param {string} tagName - 要删除的标签名
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function deleteTag(tagName) {
    try {
        // [IMPORTANT] Check if the tag is still in use before deleting
        const tasksUsingTag = await db.task_tasks.where('tags').equals(tagName).count();
        const agentsUsingTag = await db.agent_agents.where('tags').equals(tagName).count();

        if (tasksUsingTag > 0 || agentsUsingTag > 0) {
            let message = `无法删除标签 "${tagName}"，因为它仍被`;
            if (tasksUsingTag > 0) message += ` ${tasksUsingTag} 个任务`;
            if (agentsUsingTag > 0) message += ` ${agentsUsingTag} 个角色`;
            message += ` 使用。`;
            return { 
                success: false, 
                message: message
            };
        }
        
        await db.global_tags.delete(tagName);
        return { success: true };
    } catch (error) {
        console.error(`Failed to delete tag "${tagName}":`, error);
        return { success: false, message: `删除失败: ${error.message}` };
    }
}
