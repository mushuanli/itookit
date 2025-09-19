// src/common/db.js
import Dexie from 'dexie'; // Assuming you're using a bundler. If not, Dexie will be global.
import { DB_NAME, DB_VERSION } from './config.js';

export const db = new Dexie(DB_NAME);

/**
 * 定义数据库 schema。
 * 每次修改此处的 `stores` 对象，都必须在 config.js 中增加 DB_VERSION 的值。
 * 
 * --- [重构日志 v3] ---
 * 1. 为所有表添加了模块前缀 (anki_, task_, agent_, global_) 以实现高内聚。
 * 2. 将 'mistakes' 模块重命名为 'task'，对应的表为 'task_tasks'。
 * 3. 明确了所有表的主键和索引。
 */
db.version(DB_VERSION).stores({
    // --- Anki 模块表 ---
    anki_folders: '&id, name, folderId',
    anki_sessions: '&id, name, folderId, createdAt, lastActive',
        // [新增] clozeStates 表，用于存储卡片的SRS状态。主键是 'id'。
    anki_clozeStates: '&id, fileId, state, due',
    anki_reviewStats: '&id, date, folderId',

    // --- Task (原 Mistakes) 模块表 ---
    // &uuid: 主键
    // subject, *tags, analysis.reason_for_error, review.due: 索引
    task_tasks: '&uuid, listId, *tags, status, review.due',
    
    // --- Agent 模块表 ---
    agent_apiConfigs: '&id, name',
    agent_agents: '&id, name, *tags', // [MODIFIED] Add index for tags
    agent_topics: '&id, agentId, createdAt',
    agent_history: '&id, topicId, timestamp, agentId',
    
    // --- Global/App 状态表 ---
    global_appState: '&key',
    
    // [新增] 全局标签表
    // &name 表示标签名是主键，且必须唯一
    global_tags: '&name', 
    global_taskLists: '&id, &name', // [NEW]
});
