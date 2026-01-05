// @file: llm-engine/src/core/constants.ts

/**
 * 默认配置
 */
export const ENGINE_DEFAULTS = {
    /** 最大并发任务数 */
    MAX_CONCURRENT: 3,
    
    /** 任务队列最大长度 */
    MAX_QUEUE_SIZE: 10,
    
    /** 会话空闲超时（30分钟） */
    SESSION_IDLE_TIMEOUT: 30 * 60 * 1000,
    
    /** 恢复状态最大保存时间（1小时） */
    RECOVERY_MAX_AGE: 60 * 60 * 1000,
    
    /** 持久化节流间隔 */
    PERSIST_THROTTLE: 500,
    
    /** 自动清理间隔（5分钟） */
    CLEANUP_INTERVAL: 5 * 60 * 1000
};

/**
 * 存储键
 */
export const STORAGE_KEYS = {
    SESSION_RECOVERY: 'llm_session_recovery',
    PREFERENCES: 'llm_preferences'
};
