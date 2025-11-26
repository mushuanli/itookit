/**
 * @file mdx/core/processor.ts
 * @desc The headless Markdown processing engine.
 */

// ✅ 引入轻量级替代品 (需 npm install front-matter)
import fm from 'front-matter'; 

// --- 类型定义 ---

/**
 * 为 MDxProcessor 提供数据解析能力的基础接口。
 */
export interface IMentionProviderForProcessor {
  /**
   * Provider 的唯一标识符，与 mention 语法中的类型相对应 (e.g., 'user', 'file').
   */
  key: string;

  /**
   * 根据 mention 的 URI 获取其关联的数据。
   * 这是处理器进行内容替换或元数据扩充的数据来源。
   * @param targetURL - 代表 mention 的 URL 对象 (e.g., new URL('mdx://user/alice')).
   * @returns 返回一个 Promise，解析为与 mention 相关的数据对象，如果找不到则为 null。
   */
  getDataForProcess(targetURL: URL): Promise<any | null>;
}

/**
 * 定义了如何处理一种特定类型的 mention。
 */
export interface MentionRule {
  /**
   * 处理动作：
   * - 'replace': 使用 `getReplacementContent` 的返回值替换原始 mention 文本。
   * - 'keep': 保留原始 mention 文本不变。
   * - 'remove': 从文本中移除原始 mention。
   */
  action: 'replace' | 'keep' | 'remove';

  /**
   * 是否收集此类型 mention 的 ID 到最终的 `metadata` 对象中。
   * @default false
   */
  collectMetadata?: boolean;

  /**
   * 当 action 为 'replace' 时，调用此函数以获取替换内容。
   * @param data - 从 provider 的 `getDataForProcess` 方法返回的数据。
   * @param mention - 当前正在处理的 mention 的完整匹配信息。
   * @returns 用于替换的 Markdown 字符串。
   */
  getReplacementContent?: (data: any | null, mention: MentionMatch) => string;
}

/**
 * `MDxProcessor.process` 方法的配置选项。
 */
export interface ProcessOptions {
  /**
   * 一个规则字典，键是 mention 类型（如 'user', 'file'），值是对应的处理规则。
   * 可以包含一个通配符键 `'*'` 作为所有未明确指定类型的 mention 的默认规则。
   */
  rules: Record<string, MentionRule>;
}

/**
 * 在处理过程中找到的单个 mention 的结构化信息。
 */
export interface MentionMatch {
  /** 原始匹配的字符串 (e.g., '@user:alice' or '[Alice](mdx://user/alice)') */
  raw: string;
  /** mention 类型 (e.g., 'user') */
  type: string;
  /** mention ID (e.g., 'alice') */
  id: string;
  /** 标准化的 URI (e.g., 'mdx://user/alice') */
  uri: string;
  /** 在原始文本中的起始索引 */
  index: number;
  /** 从 provider 解析到的关联数据 */
  data: any | null;
}

/**
 * `MDxProcessor.process` 方法返回的最终结果。
 */
export interface ProcessResult {
  /** 传入的原始 Markdown 文本。 */
  originalContent: string;
  /** 应用所有转换规则后生成的 Markdown 文本。 */
  transformedContent: string;
  /** 在文本中找到的所有 mention 的详细信息数组（按出现顺序排序）。 */
  mentions: MentionMatch[];
  /**
   * 包含从 frontmatter 和通过 `collectMetadata` 规则收集到的所有元数据。
   * 结构: { frontmatterKey: value, mentionType: [id1, id2, ...] }
   */
  metadata: Record<string, any>;
}

/**
 * MDxProcessor 是一个无头的Markdown处理引擎，
 * 负责通过可插拔的 Provider 系统对文本进行解析、数据解析和自定义转换。
 * 
 * @example
 * const processor = new MDxProcessor([new UserProvider(), new FileMentionSource()]);
 * const result = await processor.process(markdown, { rules: myRules });
 * console.log(result.transformedContent);
 * console.log(result.metadata);
 */
export class MDxProcessor {
  private providerRegistry: Map<string, IMentionProviderForProcessor> = new Map();

  /**
   * @param providers - 一个实现了 `IMentionProviderForProcessor` 接口的 Provider 实例数组。
   */
  constructor(providers: IMentionProviderForProcessor[] = []) {
    providers.forEach(provider => this.register(provider));
  }

  /**
   * 注册一个 Mention Provider。
   * @param provider - 要注册的 provider 实例。
   */
  public register(provider: IMentionProviderForProcessor): void {
    if (!provider || !provider.key) {
      const name = provider ? provider.constructor.name : 'undefined';
      throw new Error(`[MDxProcessor] Mention provider instance (${name}) is invalid or missing the required 'key' property.`);
    }
    this.providerRegistry.set(provider.key, provider);
  }

  /**
   * 以声明式规则处理Markdown文本。
   * @param markdownText - 原始Markdown文本，可能包含 YAML frontmatter。
   * @param options - 定义如何处理每种mention的规则集。
   * @returns 一个包含所有处理细节的丰富结果对象的 Promise。
   */
  public async process(markdownText: string, options: ProcessOptions): Promise<ProcessResult> {
    // [修复] 安全的 Frontmatter 解析
    let frontmatter: Record<string, any> = {};
    let body = markdownText;

    try {
        // 只有当内容确实以 --- 开头时才尝试解析，避免不必要的错误
        if (markdownText.trimStart().startsWith('---')) {
            const parsed = fm(markdownText);
            frontmatter = parsed.attributes as Record<string, any>;
            body = parsed.body;
        }
    } catch (error) {
        // 解析失败（例如格式错误的 frontmatter），降级处理：
        // 将整个文本视为 body，不提取 attributes
        // console.warn('[MDxProcessor] Frontmatter parsing failed, treating content as raw body.', error);
        body = markdownText; 
    }

    const metadata: Record<string, any> = { ...frontmatter };

    // 阶段 1: 查找所有 Mentions
    const mentions = this._findAllMentions(body);

    // 阶段 2: 并发解析数据
    await this._resolveMentionData(mentions);

    // 阶段 3: 应用转换规则
    const transformedContent = this._applyTransformations(body, mentions, options, metadata);

    return {
      originalContent: markdownText,
      transformedContent,
      mentions: mentions.sort((a, b) => a.index - b.index),
      metadata,
    };
  }

  /**
   * @private 在文本中查找所有 mention 语法。
   */
  private _findAllMentions(content: string): MentionMatch[] {
    // 正则表达式，用于匹配两种格式:
    // 1. @type:id (e.g., @user:alice)
    // 2. [text](mdx://type/id)
    const mentionRegex = /@(\w+):(\S+)|\[[^\]]+\]\(mdx:\/\/(\w+)\/([^)]+)\)/g;
    return Array.from(content.matchAll(mentionRegex)).map(match => {
      const isAtMention = !!match[1];
      const type = isAtMention ? match[1] : match[3];
      const id = isAtMention ? match[2] : match[4];
      return {
        raw: match[0],
        type,
        id,
        uri: `mdx://${type}/${id}`,
        index: match.index!,
        data: null,
      };
    });
  }

  /**
   * @private 并发地为所有找到的 mention 获取数据。
   */
  private async _resolveMentionData(mentions: MentionMatch[]): Promise<void> {
    await Promise.all(mentions.map(async (mention) => {
      const provider = this.providerRegistry.get(mention.type);
      if (provider?.getDataForProcess) {
        try {
          mention.data = await provider.getDataForProcess(new URL(mention.uri));
        } catch (error) {
          console.error(`[MDxProcessor] Provider "${mention.type}" failed to get data for "${mention.uri}":`, error);
          mention.data = null; // 确保出错时 data 为 null
        }
      }
    }));
  }

  /**
   * @private 根据规则转换内容并收集元数据。
   */
  private _applyTransformations(
    content: string,
    mentions: MentionMatch[],
    options: ProcessOptions,
    metadata: Record<string, any>
  ): string {
    let transformed = content;
    const sortedMentions = [...mentions].sort((a, b) => b.index - a.index);

    for (const mention of sortedMentions) {
      const rule = options.rules[mention.type] || options.rules['*'];
      if (!rule) continue;

      if (rule.collectMetadata && mention.id) {
        if (!metadata[mention.type]) {
          metadata[mention.type] = [];
        }
        if (!metadata[mention.type].includes(mention.id)) {
            metadata[mention.type].push(mention.id);
        }
      }

      let replacement = '';
      switch (rule.action) {
        case 'replace':
          replacement = rule.getReplacementContent ? rule.getReplacementContent(mention.data, mention) : mention.raw;
          break;
        case 'keep':
          replacement = mention.raw;
          break;
        case 'remove':
          break;
      }
      
      const startIndex = mention.index;
      const endIndex = startIndex + mention.raw.length;
      transformed = transformed.slice(0, startIndex) + replacement + transformed.slice(endIndex);
    }
    return transformed.trim();
  }
}
