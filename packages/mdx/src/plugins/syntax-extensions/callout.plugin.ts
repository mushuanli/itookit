/**
 * @file mdx/plugins/syntax-extensions/callout.plugin.ts
 * @desc 支持 GitHub/Obsidian 风格的 Callouts (提示块)
 * 语法:
 * > [!NOTE]
 * > 内容...
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MarkedExtension, Tokens } from 'marked';

export interface CalloutPluginOptions {
    /** 是否默认折叠 (暂未实现，保留接口) */
    defaultFolded?: boolean;
}

// 定义支持的类型和对应的标题/图标映射
const CALLOUT_TYPES: Record<string, string> = {
    note: 'Note',
    abstract: 'Abstract',
    info: 'Info',
    todo: 'Todo',
    tip: 'Tip',
    success: 'Success',
    question: 'Question',
    warning: 'Warning',
    failure: 'Failure',
    danger: 'Danger',
    bug: 'Bug',
    example: 'Example',
    quote: 'Quote',
};

export class CalloutPlugin implements MDxPlugin {
    name = 'syntax:callout';

    constructor(private options: CalloutPluginOptions = {}) { }

    install(context: PluginContext): void {
        // 注册 Marked 扩展
        context.registerSyntaxExtension(this.getMarkedExtension());
    }

    private getMarkedExtension(): MarkedExtension {
        return {
            // 使用 walkTokens 在解析后处理 Token 树（比自定义 tokenizer 更简单且兼容性好）
            walkTokens: (token: any) => {
                if (token.type !== 'blockquote') return;

                // 检查 blockquote 的第一个子 token 是否包含 callout 标记
                const firstToken = token.tokens?.[0];
                if (!firstToken || firstToken.type !== 'paragraph') return;

                const firstText = firstToken.text || '';
                // 匹配 > [!TYPE] 格式
                const match = firstText.match(/^\[!(\w+)\]([^\n]*)/i);

                if (match) {
                    const type = match[1].toLowerCase();
                    const title = match[2].trim() || CALLOUT_TYPES[type] || type.charAt(0).toUpperCase() + type.slice(1);

                    // 修改 token 类型为 html，直接渲染自定义结构
                    // 注意：这里我们需要递归渲染内部的内容
                    token.type = 'callout';
                    token.calloutType = type;
                    token.calloutTitle = title;

                    // 移除标记文本，保留剩余内容
                    // 实际上 marked 的 parser 比较复杂，这里我们做一个简化的 token 转换
                    // 更稳健的做法是编写自定义 Tokenizer，但 walkTokens 足够处理大部分情况

                    // 移除第一行标记文本
                    const rawText = firstToken.text;
                    const cleanText = rawText.replace(/^\[!(\w+)\][^\n]*/i, '').trim();
                    firstToken.text = cleanText;

                    // 如果移除标记后第一段为空，则删除该 token (除非只有这一个 token)
                    if (!cleanText && token.tokens.length > 1) {
                        token.tokens.shift();
                    } else if (!cleanText) {
                        // 如果只有一个 token 且为空，保留它防止结构崩溃，但内容为空
                        firstToken.text = '';
                    }
                }
            },
            extensions: [{
                name: 'callout',
                level: 'block',
                renderer(token: any) {
                    // 构建 HTML
                    const typeClass = `mdx-callout-${token.calloutType}`;
                    // 使用 parser.parse 解析内部 tokens
                    const content = this.parser.parse(token.tokens);

                    // 图标可以是 SVG，这里为了简洁使用 CSS content 或类名控制
                    return `
            <div class="mdx-callout ${typeClass}">
              <div class="mdx-callout-title">
                <span class="mdx-callout-icon"></span>
                <span class="mdx-callout-text">${token.calloutTitle}</span>
              </div>
              <div class="mdx-callout-content">
                ${content}
              </div>
            </div>
          `;
                }
            }]
        };
    }
}
