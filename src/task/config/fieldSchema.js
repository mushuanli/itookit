// src/task/config/fieldSchema.js

/**
 * 定义所有核心任务字段的模式。
 * 这是系统的单一事实来源，用于解析、生成和格式化字段。
 */
export const FIELD_SCHEMA = {
    // 键名 'status' 是内部使用的 fieldName
    status: {
        label: '状态', // 显示名
        type: 'enum',  // 数据类型
        defaultValue: 'todo',
        // 值的映射表，用于显示
        valueMap: {
            'todo': '待办',
            'in_progress': '进行中',
            'completed': '已完成',
            'archived': '已归档'
        }
    },
    priority: {
        label: '优先级',
        type: 'enum',
        defaultValue: 1,
        valueMap: {
            1: '低',
            2: '中',
            3: '高',
            4: '紧急'
        }
    },
    // [新增] 添加创建和修改时间的 Schema 定义
    createdAt: {
        label: '创建时间',
        type: 'datetime',
        defaultValue: null
    },
    updatedAt: {
        label: '最后修改',
        type: 'datetime',
        defaultValue: null
    },
    dueDate: {
        label: '截止日期',
        type: 'date',
        defaultValue: null
    },
    note: {
        label: '笔记',
        type: 'multiline_string', // 多行文本
        defaultValue: ''
    },
    reason: {
        label: '原因',
        type: 'multiline_string',
        defaultValue: ''
    }
    // 未来可以轻松地在这里添加更多核心字段
};

/**
 * 辅助函数，通过内部字段名获取其完整定义。
 * @param {string} fieldName - 内部字段名 (e.g., 'dueDate')
 * @returns {object | undefined} 字段的定义对象
 */
export function getFieldDef(fieldName) {
    return FIELD_SCHEMA[fieldName];
}
