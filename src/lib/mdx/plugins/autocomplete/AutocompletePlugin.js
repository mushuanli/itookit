/**
 * @file #mdx/plugins/autocomplete/AutocompletePlugin.js
 * @fileoverview A generic, configurable autocomplete plugin for CodeMirror.
 */

import { autocompletion } from "@codemirror/autocomplete";

export class AutocompletePlugin {
    name = 'feature:autocomplete';

    /**
     * @param {object} options
     * @param {import('./autocomplete.types.js').AutocompleteSourceOptions[]} options.sources - 一个或多个自动完成数据源的配置数组。
     */
    constructor(options = {}) {
        this.sources = options.sources || [];
    }

    /**
     * @param {import('../../core/plugin.js').PluginContext} context
     */
    install(context) {
        // 覆盖 CodeMirror 默认的自动完成，提供我们自己的多源逻辑
        const autocompleteExtension = autocompletion({
            override: [this.createAutocompleteSource()]
        });
        context.registerCodeMirrorExtension(autocompleteExtension);
    }

    /**
     * 创建一个 CodeMirror 自动完成源函数。
     * @returns {import('@codemirror/autocomplete').CompletionSource}
     */
    createAutocompleteSource = () => {
        const self = this;
        return async (ctx) => {
            // 动态构建一个正则表达式，以匹配所有已配置的触发字符
            const triggerChars = self.sources.map(s => s.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
            if (!triggerChars) return null;
            
            const triggerRegex = new RegExp(`[${triggerChars}](\\w*)$`);
            const match = ctx.matchBefore(triggerRegex);

            if (!match) {
                return null;
            }

            const trigger = match.text[0];
            const query = match.text.substring(1);

            // 找到与当前触发字符匹配的配置源
            const sourceConfig = self.sources.find(s => s.triggerChar === trigger);
            if (!sourceConfig) {
                return null;
            }

            try {
                const suggestions = await sourceConfig.provider.getSuggestions(query);

                return {
                    from: match.from,
                    options: suggestions.map(suggestion => ({
                        label: suggestion.label,
                        type: sourceConfig.completionType || 'autocomplete-item',
                        apply: (view) => {
                            // 使用配置的模板函数来生成要插入的文本
                            const textToInsert = sourceConfig.applyTemplate(suggestion);
                            view.dispatch({
                                changes: { from: match.from, to: ctx.pos, insert: textToInsert },
                                selection: { anchor: match.from + textToInsert.length } // 移动光标到插入内容之后
                            });
                        }
                    })),
                    // 我们自己处理过滤，所以禁用 CodeMirror 的内置过滤
                    filter: false,
                };
            } catch (error) {
                console.error(`[AutocompletePlugin] Provider for trigger '${trigger}' failed to get suggestions:`, error);
                return null;
            }
        };
    }
}
