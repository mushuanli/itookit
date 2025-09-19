// src/common/FieldFormatter.js
import { getFieldDef } from '../task/config/fieldSchema.js';
import { escapeHTML } from './utils.js';

/**
 * 一个用于格式化结构化字段以便在UI中显示的静态类。
 */
export class FieldFormatter {

    /**
     * 根据字段模式，将字段名和值格式化为可读的 HTML。
     * @param {string} fieldName - 字段的内部名 (e.g., 'dueDate')
     * @param {any} rawValue - 字段的原始值 (e.g., 1725753600000)
     * @returns {string} - 格式化后的 HTML 字符串
     */
    static format(fieldName, rawValue) {
        const def = getFieldDef(fieldName);
        if (!def) {
            // 对于 schema 中未定义的自定义字段，进行简单显示
            return `
                <div class="field-item">
                    <strong class="field-label">${escapeHTML(fieldName)}:</strong>
                    <span class="field-value">${escapeHTML(String(rawValue))}</span>
                </div>
            `;
        }

        let displayValue = '';
        switch (def.type) {
            case 'date':
                displayValue = this.formatDate(rawValue);
                break;
            // [新增] 处理新的 datetime 类型
            case 'datetime':
                displayValue = this.formatDateTime(rawValue);
                break;
            case 'enum':
                // 从 valueMap 中查找显示值，找不到则显示原始值
                displayValue = def.valueMap[rawValue] || rawValue;
                break;
            default:
                // 对于 string 和 multiline_string，直接使用
                displayValue = rawValue;
        }

        return `
            <div class="field-item field-type-${def.type}">
                <strong class="field-label">${escapeHTML(def.label)}:</strong>
                <span class="field-value">${escapeHTML(displayValue)}</span>
            </div>
        `;
    }

    /**
     * 将日期时间戳格式化为智能的、可读的字符串。
     * @param {number} timestamp - 日期的时间戳
     * @returns {string} 格式化后的日期字符串
     */
    static formatDate(timestamp) {
        if (!timestamp) return '未设置';
        const date = new Date(timestamp);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const dateWithoutTime = new Date(date);
        dateWithoutTime.setHours(0, 0, 0, 0);

        const diffDays = Math.ceil((dateWithoutTime - today) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return '今天';
        if (diffDays === 1) return '明天';
        if (diffDays === -1) return '昨天';
        
        return date.toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    /**
     * [新增] 将日期时间戳格式化为详细的、本地化的字符串。
     * @param {number} timestamp - 日期的时间戳
     * @returns {string} 格式化后的日期时间字符串
     */
    static formatDateTime(timestamp) {
        if (!timestamp) return '未设置';
        return new Date(timestamp).toLocaleString(undefined, {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
}

