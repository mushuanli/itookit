/**
 * @file mdxeditor/core/processor.js
 * @description The headless Markdown processing engine.
 */

// Define types for JSDoc
/** @typedef {import('@itookit/common').IMentionProvider} IMentionProvider */
/** @typedef {import('./types.js').ProcessOptions} ProcessOptions */
/** @typedef {import('./types.js').ProcessResult} ProcessResult */

/**
 * MDxProcessor is a headless Markdown processing engine responsible for
 * parsing, data resolution, and custom transformations on text via a pluggable provider system.
 */
export class MDxProcessor {
    /**
     * @param {IMentionProvider[]} [providers=[]] - An array of MentionProvider instances.
     */
    constructor(providers = []) {
        /** @private */
        this.providerRegistry = new Map();
        providers.forEach(provider => this.register(provider));
    }

    /**
     * Registers a Mention Provider.
     * @param {IMentionProvider} provider
     */
    register(provider) {
        if (!provider || !provider.key) {
            const name = provider ? provider.constructor.name : 'undefined';
            throw new Error(`[MDxProcessor] Mention provider instance (${name}) is invalid or missing the required 'key' property.`);
        }
        this.providerRegistry.set(provider.key, provider);
    }

    /**
     * Processes Markdown text with declarative rules.
     * @param {string} markdownText
     * @param {ProcessOptions} options
     * @returns {Promise<ProcessResult>}
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
        /** @type {Object.<string, string[]>} */ // [FIX] Added JSDoc type hint
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
