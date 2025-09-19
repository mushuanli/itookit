// src/services/storageService.js
import { db } from '../common/db.js';

// ===================================================================
//                        Anki 模块存储服务
// ===================================================================

/**
 * [重构] 加载 Anki 模块核心数据和全局持久化状态。
 */
export async function loadAnkiData() {
    // [精简] 移除了对 anki_reviewStats 表的加载，因为它已不再被全局 dataService 使用。
    const [sessions, folders, clozeStates, appStateValues] = await Promise.all([
        db.anki_sessions.toArray().catch(e => { console.error('Failed to load anki_sessions', e); return []; }),
        db.anki_folders.toArray().catch(e => { console.error('Failed to load anki_folders', e); return []; }),
        db.anki_clozeStates.toArray().catch(e => { console.error('Failed to load anki_clozeStates', e); return []; }),
        db.global_appState.toArray().catch(e => { console.error('Failed to load global_appState', e); return []; }),
    ]);

    // [修正] 将 clozeStates 数组转换为以 id 为 key 的对象
    const reconstructedClozeStates = clozeStates.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    const reconstructedAppState = appStateValues.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    return {
        sessions,
        folders,
        clozeStates: reconstructedClozeStates,
        persistentAppState: reconstructedAppState,
    };
}

/**
 * [重构] 保存 Anki 模块核心数据和全局持久化状态。
 * @param {object} data - 包含要保存的 anki 数据的对象。
 */
export async function saveAnkiData({ sessions, folders, clozeStates, persistentAppState }) {
    const tablesToUpdate = [db.anki_sessions, db.anki_folders, db.anki_clozeStates, db.global_appState];

    await db.transaction('rw', tablesToUpdate, async () => {
        const clozeDataForDB = Object.values(clozeStates);
        const appStateDataForDB = Object.entries(persistentAppState).map(([key, value]) => ({ key, value }));

        const existingSessionIds = new Set(sessions.map(s => s.id));
        const existingFolderIds = new Set(folders.map(f => f.id));
        const existingClozeIds = new Set(Object.keys(clozeStates));
        const existingAppStateKeys = new Set(Object.keys(persistentAppState));

        // 清理不再存在的数据
        await Promise.all([
            db.anki_sessions.where('id').noneOf(Array.from(existingSessionIds)).delete(),
            db.anki_folders.where('id').noneOf(Array.from(existingFolderIds)).delete(),
            db.anki_clozeStates.where('id').noneOf(Array.from(existingClozeIds)).delete(),
            db.global_appState.where('key').noneOf(Array.from(existingAppStateKeys)).delete(),
        ]);
        
        // 批量写入新数据
        await Promise.all([
            db.anki_sessions.bulkPut(sessions),
            db.anki_folders.bulkPut(folders),
            db.anki_clozeStates.bulkPut(clozeDataForDB),
            db.global_appState.bulkPut(appStateDataForDB),
        ]);
    });
}

// --- [移除] ---
// 以下函数 (anki_incrementReviewCount, anki_getStatsForDateRange, anki_getTodaysTotalCount)
// 的功能已被新的 `src/anki/ankiApp.js` 及其 `store` 和 `services` 完全接管，
// 不再需要从全局 storageService 调用。因此予以移除。


// ===================================================================
//                        Agent 模块存储服务
// ===================================================================

/**
 * [重构] 加载 Agent 模块的所有数据。
 * @returns {Promise<object>}
 */
export async function loadAgentData() {
    try {
        const [apiConfigs, agents, topics, history] = await Promise.all([
            db.agent_apiConfigs.toArray(),
            db.agent_agents.toArray(),
            db.agent_topics.toArray(),
            db.agent_history.toArray(),
        ]);
        return { apiConfigs, agents, topics, history };
    } catch (error) {
        console.error("[Storage/Agent] Failed to load agent data:", error);
        return { apiConfigs: [], agents: [], topics: [], history: [] };
    }
}

/**
 * [重构] 保存 Agent 模块的所有数据。
 * 这个函数采用“先删除后添加”的策略，以原子事务的方式确保数据一致性。
 * 它会删除数据库中存在但当前 appState 中不存在的记录，然后批量更新或插入所有当前记录。
 * @param {object} data - 包含 Agent 模块所有数据的对象。
 * @param {Array<object>} data.apiConfigs - 所有 API 配置。
 * @param {Array<object>} data.agents - 所有 Agent (角色)。
 * @param {Array<object>} data.topics - 所有聊天主题。
 * @param {Array<object>} data.history - 所有历史消息。
 */

export async function saveAgentData({ apiConfigs, agents, topics, history }) {
    // 定义本次事务需要读写的所有相关表
    const tables = [
        db.agent_apiConfigs, 
        db.agent_agents, 
        db.agent_topics, 
        db.agent_history
    ];

    // 使用 Dexie 的事务 (transaction) 来保证所有操作要么全部成功，要么全部失败。
    await db.transaction('rw', tables, async () => {
        // --- 步骤 1: 准备数据 ---
        // 从当前的应用状态 (传入的参数) 中，提取所有记录的ID，放入Set中以便快速查找。
        const existingApiConfigIds = new Set(apiConfigs.map(c => c.id));
        const existingAgentIds = new Set(agents.map(p => p.id));
        const existingTopicIds = new Set(topics.map(t => t.id));
        const existingHistoryIds = new Set(history.map(h => h.id));

        // --- 步骤 2: 清理过时数据 ---
        // 并行执行删除操作，提高效率。
        // Dexie 的 .where('id').noneOf(...) 方法会高效地找出并删除那些在数据库中存在，
        // 但在当前 `existing...Ids` Set 中不存在的记录。
        await Promise.all([
            db.agent_apiConfigs.where('id').noneOf(Array.from(existingApiConfigIds)).delete(),
            db.agent_agents.where('id').noneOf(Array.from(existingAgentIds)).delete(),
            db.agent_topics.where('id').noneOf(Array.from(existingTopicIds)).delete(),
            db.agent_history.where('id').noneOf(Array.from(existingHistoryIds)).delete(),
        ]);
        
        // --- 步骤 3: 批量写入新数据 ---
        // 再次并行执行写入操作。
        // Dexie 的 .bulkPut() 方法会智能地处理插入和更新：
        // - 如果记录的ID已存在，它会更新该记录。
        // - 如果记录的ID不存在，它会插入新记录。
        await Promise.all([
            db.agent_apiConfigs.bulkPut(apiConfigs),
            db.agent_agents.bulkPut(agents),
            db.agent_topics.bulkPut(topics),
            db.agent_history.bulkPut(history),
        ]);
    });
}

// ===================================================================
//                   Task (原 Mistakes) 模块存储服务
// ===================================================================

/**
 * [重构] 加载所有 Tasks。
 * @returns {Promise<Array>}
 */
export async function loadAllTasks() {
    // [修正] 恢复 try...catch 保护
    try {
        if (!db.isOpen()) await db.open();
        return await db.task_tasks.toArray();
    } catch (error) {
        console.error("[Storage/Task] Failed to load tasks from DB:", error);
        return [];
    }
}

/**
 * [重构] 批量保存 Tasks。
 * @param {Array<object>} tasks 
 */
export async function saveAllTasks(tasks) {
    try {
        const now = Date.now();
        // [关键] 对每一个要保存的任务，都更新其 `updatedAt` 时间戳
        const tasksWithTimestamp = tasks.map(task => ({
            ...task,
            updatedAt: now
        }));
        await db.task_tasks.bulkPut(tasksWithTimestamp);
    } catch (error) {
        console.error("[Storage/Task] Failed to save tasks to DB:", error);
    }
}

/**
 * [重构] 更新单个 Task。
 * @param {object} task 
 */
export async function updateTask(task) {
    if (!task || !task.uuid) {
        console.error("[Storage/Task] Failed to update task: Invalid task object or UUID.", task);
        return; // 返回，避免写入无效数据
    }
    try {
        // [关键] 在每次更新时，自动设置最后修改时间
        const taskWithTimestamp = {
            ...task,
            updatedAt: Date.now() 
        };
        await db.task_tasks.put(taskWithTimestamp);
    } catch (error) {
        console.error(`[Storage/Task] Failed to update task ${task.uuid}:`, error);
    }
}

/**
 * [重构] 根据 UUID 删除多个 Tasks。
 * @param {string[]} taskUuids 
 */
export async function deleteTasks(taskUuids) {
    try {
        await db.task_tasks.bulkDelete(taskUuids);
    } catch(error) {
        console.error("[Storage/Task] Failed to delete tasks:", error);
    }
}