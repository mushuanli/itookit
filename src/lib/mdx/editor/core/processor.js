/**
 * @file mdx/editor/core/processor.js
 * @fileoverview The new headless Markdown processing engine.
 */

/**
 * MDxProcessor 是一个无头的Markdown处理引擎，
 * 负责通过可插拔的 Provider 系统对文本进行解析、数据解析和自定义转换。
 */
export class MDxProcessor {
    /**
     * @param {import('../../../common/interfaces/IMentionProvider.js').IMentionProvider[]} [providers=[]] - 一个 MentionProvider 实例数组。
     */
    constructor(providers = []) {
        /** @private */
        this.providerRegistry = new Map();
        providers.forEach(provider => this.register(provider));
    }

    /**
     * 注册一个 Mention Provider。
     * @param {import('../../../common/interfaces/IMentionProvider.js').IMentionProvider} provider
     */
    register(provider) {
        if (!provider || !provider.key) {
            const name = provider ? provider.constructor.name : 'undefined';
            throw new Error(`[MDxProcessor] Mention provider instance (${name}) is invalid or missing the required 'key' property.`);
        }
        this.providerRegistry.set(provider.key, provider);
    }

    /**
     * 以声明式规则处理Markdown文本。
     * @param {string} markdownText - 原始Markdown文本。
     * @param {import('./types.js').ProcessOptions} options - 定义如何处理每种mention的规则集。
     * @returns {Promise<import('./types.js').ProcessResult>} 一个包含所有处理细节的丰富结果对象。
     */
    async process(markdownText, options) {
        // A more robust regex to find @mentions and link-style mentions
        const mentionRegex = /@(\w+):(\S+)|\[[^\]]+\]\(mdx:\/\/(\w+)\/([^)]+)\)/g;
        
        const matches = Array.from(markdownText.matchAll(mentionRegex)).map(match => {
            const isAtMention = !!match[1];
            const type = isAtMention ? match[1] : match[3];
            const id = isAtMention ? match[2] : match[4];
            return {
                raw: match[0],
                type,
                id,
                uri: `mdx://${type}/${id}`,
                index: match.index,
                data: null // To be populated
            };
        });

        // --- Stage 1: Data Resolution Phase ---
        // Concurrently fetch data for all found mentions.
        await Promise.all(matches.map(async (mention) => {
            const provider = this.providerRegistry.get(mention.type);
            if (provider?.getDataForProcess) {
                try {
                    mention.data = await provider.getDataForProcess(new URL(mention.uri));
                } catch (error) {
                    console.error(`[MDxProcessor] Provider "${mention.type}" failed to get data for "${mention.uri}":`, error);
                    mention.data = null; // Ensure data is null on error
                }
            }
        }));

        let transformedContent = markdownText;
        const metadata = {};

        // --- Stage 2: Transformation Phase ---
        // Iterate backwards to apply changes without messing up indices.
        for (let i = matches.length - 1; i >= 0; i--) {
            const mention = matches[i];
            const rule = options.rules[mention.type] || options.rules['*'];
            if (!rule) continue;

            // a. Metadata Collection
            if (rule.collectMetadata && mention.id) {
                if (!metadata[mention.type]) {
                    metadata[mention.type] = [];
                }
                metadata[mention.type].push(mention.id);
            }

            // b. Content Transformation
            let replacement = '';
            if (rule.action === 'replace') {
                replacement = rule.getReplacementContent ? rule.getReplacementContent(mention.data, mention) : mention.raw;
            } else if (rule.action === 'keep') {
                replacement = mention.raw;
            }
            // For 'remove', replacement remains an empty string.

            const startIndex = mention.index;
            const endIndex = startIndex + mention.raw.length;
            transformedContent = transformedContent.slice(0, startIndex) + replacement + transformedContent.slice(endIndex);
        }
        
        return {
            originalContent: markdownText,
            transformedContent: transformedContent.trim(),
            mentions: matches.sort((a, b) => a.index - b.index), // Return mentions in original order
            metadata,
        };
    }
}
