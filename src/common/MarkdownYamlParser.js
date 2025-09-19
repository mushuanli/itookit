// src/common/MarkdownYamlParser.js
import { FIELD_SCHEMA } from '../task/config/fieldSchema.js';

// [重构] 新的、更严格的正则表达式
// 捕获组: 1=fieldName, 2=DisplayName (忽略), 3=单行值, 4=多行缩进值
const STRUCTURED_FIELD_REGEX = /^::>\[::([a-zA-Z0-9_]+)::\]\s*(?:.*?)(?::\s*(.*))?\n?((?:^[ \t]{4,}.*\n?)*)/gm;

export class MarkdownYamlParser {

    /**
     * [重构] 将包含新语法的 Markdown 解析为结构化对象。
     * 只解析在 FIELD_SCHEMA 中定义的字段。
     */
    static parseMarkdownToYaml(markdownText) {
        const data = {};
        let detailsContent = markdownText;
        let metadataContent = '';

        const separatorIndex = markdownText.indexOf('\n---\n');

        if (separatorIndex !== -1) {
            detailsContent = markdownText.substring(0, separatorIndex).trim();
            metadataContent = markdownText.substring(separatorIndex + 5); // 5 is length of '\n---\n'
        } else {
            // 如果没有分隔符，为了向后兼容，假定所有内容都是元数据区
            // （或者可以全部视为details，这里选择前者）
            metadataContent = detailsContent;
            detailsContent = '';
        }
        
        const regex = new RegExp(STRUCTURED_FIELD_REGEX);
        let match;

        // [关键] 只在元数据内容上运行正则匹配
        while ((match = regex.exec(metadataContent)) !== null) {
            const [fullMatch, fieldName, singleLineValue, multiLineContent] = match;

            // 检查字段名是否在我们的核心模式中定义
            if (FIELD_SCHEMA[fieldName]) {
                 const rawValue = (multiLineContent 
                    ? multiLineContent.split('\n').map(line => line.substring(4)).join('\n').trim()
                    : (singleLineValue || '').trim());
                
                // 根据 schema 定义进行类型转换
                const fieldDef = FIELD_SCHEMA[fieldName];
                if (fieldDef.type === 'number' || (fieldDef.type === 'enum' && typeof fieldDef.defaultValue === 'number')) {
                    data[fieldName] = parseInt(rawValue, 10) || fieldDef.defaultValue;
                // [关键修正] 将 date 和 datetime 合并处理，都转换为数字时间戳
                } else if (fieldDef.type === 'date' || fieldDef.type === 'datetime') {
                    const parsedTimestamp = Date.parse(rawValue);
                    data[fieldName] = isNaN(parsedTimestamp) ? null : parsedTimestamp;
                } else {
                    data[fieldName] = rawValue;
                }
            }
        }

        data.details = detailsContent;
        return { success: true, data };
    }

    /**
     * [重构] 生成 Markdown 时也遵循 Front Matter 结构。
     */
    static parseYamlToMarkdown(taskData) {
        let details = taskData.details || '';
        const fieldsMd = [];
        
        for (const fieldName in FIELD_SCHEMA) {
            // [修正] 只处理有意义的值（不为null, undefined, 或空字符串）
            const value = taskData[fieldName];
            if (value != null && value !== '') {
                // ... (字段到文本的转换逻辑保持不变) ...
                 const fieldDef = FIELD_SCHEMA[fieldName];
                 let valueString = '';
                 
                 // [关键修正] 统一处理时间相关类型
                 if (fieldDef.type === 'date' && typeof value === 'number') {
                     valueString = new Date(value).toISOString().split('T')[0];
                 // [关键修正] 添加对 datetime 类型的处理
                 } else if (fieldDef.type === 'datetime' && typeof value === 'number') {
                     // 将数字时间戳直接转换为字符串，以便解析器可以读回
                     valueString = String(value);
                 } else {
                     valueString = String(value);
                 }
                 if (fieldDef.type === 'multiline_string') {
                     const indentedContent = valueString.split('\n').map(line => `    ${line}`).join('\n');
                     fieldsMd.push(`::>[::${fieldName}::] ${fieldDef.label}\n${indentedContent}`);
                 } else {
                     fieldsMd.push(`::>[::${fieldName}::] ${fieldDef.label}: ${valueString}`);
                 }
            }
        }
        
        // 只有当存在元数据时才添加分隔符
        if (fieldsMd.length > 0) {
            // [修正] 确保 details 和分隔符之间有适当的间距
            const detailsPart = details ? `${details}\n\n` : '';
            return `${detailsPart}---\n\n${fieldsMd.join('\n\n')}`.trim();
        }

        // [修正] 之前这里有一个 bug，引用了未定义的变量 `markdown`
        return details;
    }
}
