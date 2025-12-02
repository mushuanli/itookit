// mdx/plugins/autocomplete/mention.plugin.ts

import type { HoverPreviewData } from '@itookit/common';
import type { Completion } from '@codemirror/autocomplete';
import type { MarkedExtension, Token } from 'marked';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AutocompletePlugin } from './autocomplete.plugin';

/**
 * 提及项
 */
export interface MentionItem {
  id: string;
  label: string;
  /**
   * ✨ [新增] 纯文本标题，用于插入到 Markdown 中。
   * 如果未提供，则回退使用 label。
   */
  title?: string;
  /**
   * 类型：用于 UI 显示和分组，例如 'file', 'directory', 'user'
   */
  type?: string;
  avatar?: string;
  [key: string]: any;
}

/**
 * 提及提供者接口
 */
export interface MentionProvider {
  /**
   * 提供者的唯一键（如 'file', 'dir', 'user'）
   * 这将作为 mdx:// protocol 的 host 部分
   */
  key: string;

  /**
   * 触发字符（如 '@', '#'）
   */
  triggerChar: string;

  /**
   * 获取建议列表
   */
  getSuggestions(query: string): MentionItem[] | Promise<MentionItem[]>;

  /**
   * 获取悬浮预览内容
   */
  getHoverPreview?(uri: string): Promise<HoverPreviewData | null>;

  /**
   * 获取完整内容（用于内容嵌入）
   */
  getFullContent?(id: string): Promise<string>;
}

/**
 * 提及插件选项
 */
export interface MentionPluginOptions {
  /**
   * 提及提供者列表
   */
  providers: MentionProvider[];

  /**
   * 是否启用悬浮预览（默认 true）
   */
  enableHoverPreview?: boolean;

  /**
   * 是否启用点击事件（默认 true）
   */
  enableClickHandler?: boolean;

  /**
   * 是否启用内容嵌入（默认 true）
   */
  enableTransclusion?: boolean;

  /**
   * 点击提及时的回调
   */
  onMentionClick?: (provider: string, id: string) => void;
}

/**
 * 提及自动完成插件
 */
export class MentionPlugin implements MDxPlugin {
  name = 'autocomplete:mention';
  private options: Required<MentionPluginOptions>;
  private autocompletePlugin: AutocompletePlugin;
  private hoverCard: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(options: MentionPluginOptions) {
    this.options = {
      providers: options.providers,
      enableHoverPreview: options.enableHoverPreview !== false,
      enableClickHandler: options.enableClickHandler !== false,
      enableTransclusion: options.enableTransclusion !== false,
      onMentionClick: options.onMentionClick || (() => {}),
    };

    // 1. 按 triggerChar 对 Provider 进行分组
    // 解决多个 Provider 使用相同触发字符（如 '@'）时只有第一个生效的问题
    const groupedProviders = new Map<string, MentionProvider[]>();

    this.options.providers.forEach((provider) => {
      if (!groupedProviders.has(provider.triggerChar)) {
        groupedProviders.set(provider.triggerChar, []);
      }
      groupedProviders.get(provider.triggerChar)!.push(provider);
    });

    // 2. 为每个触发字符创建一个聚合的 Source
    const sources = Array.from(groupedProviders.entries()).map(([triggerChar, providers]) => {
      return {
        triggerChar: triggerChar,

        // 聚合 Provider
        provider: {
          getSuggestions: async (query: string): Promise<Completion[]> => {
            // 并行调用该组下所有 Provider 的查询
            const promises = providers.map(async (p) => {
              try {
                const results = await p.getSuggestions(query);
                // 注入 providerKey，以便后续 applyTemplate 知道用哪个 key
                return results.map((item) => ({
                  ...item,
                  _providerKey: p.key, // 内部标记
                  // 确保 detail 有值，优先使用 item.type，否则用 provider.key
                  detail: item.type ? this.formatType(item.type) : this.formatType(p.key),
                  // 利用 section 属性进行 UI 分组 (CodeMirror 特性)
                  section: this.getSectionName(item.type || p.key),
                }));
              } catch (e) {
                console.warn(`[MentionPlugin] Provider ${p.key} failed:`, e);
                return [];
              }
            });

            const nestedResults = await Promise.all(promises);
            // 扁平化结果
            return nestedResults.flat() as Completion[];
          },

          // 聚合 HoverPreview (针对 Autocomplete 菜单侧边的预览，如果有的话)
          getHoverPreview: async (item: Completion) => {
            const mentionItem = item as any;
            const providerKey = mentionItem._providerKey;
            const provider = providers.find((p) => p.key === providerKey);

            if (provider && provider.getHoverPreview) {
              const uri = `mdx://${providerKey}/${mentionItem.id}`;
              return provider.getHoverPreview(uri);
            }
            return Promise.resolve(null);
          },
        },

        // 模板应用：生成 Markdown
        applyTemplate: (completion: Completion) => {
          const item = completion as any;
          const providerKey = item._providerKey || providers[0].key; // Fallback safety

          // 优先使用 title (纯文本)，如果不存在则回退到 label
          const textToInsert = item.title || item.label;

          // 生成标准格式: [Label](mdx://provider/id)
          return `[${textToInsert}](mdx://${providerKey}/${item.id}) `;
        },
      };
    });

    this.autocompletePlugin = new AutocompletePlugin({ sources });
  }

  /**
   * 格式化类型显示 (例如 'directory' -> 'Directory')
   */
  private formatType(type: string): string {
    if (!type) return '';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /**
   * 获取分组名称，用于排序和展示
   */
  private getSectionName(type: string): string {
    const t = type.toLowerCase();
    if (t.includes('dir') || t.includes('folder')) return 'Folders';
    if (t.includes('file') || t.includes('doc')) return 'Files';
    if (t.includes('user') || t.includes('contact')) return 'People';
    return 'Others';
  }

  /**
   * 创建 Marked 扩展：
   * 1. mdxLink: 渲染 mdx:// 链接为可交互的 <a> 标签
   * 2. mdxTransclusion: 解析 !@provider:id 语法为占位符 <div>
   */
  private createMarkedExtension(): MarkedExtension {
    return {
      extensions: [
        {
          name: 'mdxLink',
          level: 'inline',
          start: (src: string) => src.indexOf(']('),
          tokenizer: (src: string): Token | undefined => {
            // 匹配 [label](mdx://provider/id)
            const match = src.match(/^\[([^\]]+)\]\(mdx:\/\/([^/]+)\/([^)]+)\)/);
            if (!match) return undefined;

            return {
              type: 'mdxLink',
              raw: match[0],
              text: match[1],
              provider: match[2],
              id: match[3],
            } as any;
          },
          renderer: (token: any) => {
            const uri = `mdx://${token.provider}/${token.id}`;
            return `<a href="${uri}" class="mdx-mention" data-mdx-uri="${uri}" data-provider="${token.provider}" data-id="${token.id}">${token.text}</a>`;
          },
        },
        this.options.enableTransclusion
          ? {
              name: 'mdxTransclusion',
              level: 'block',
              start: (src: string) => src.match(/!@/)?.index,
              tokenizer(src: string): Token | undefined {
                const rule = /^!@(\w+):(\S+)(?:\n|$)/;
                const match = rule.exec(src);
                if (match) {
                  const [raw, providerKey, id] = match;
                  return {
                    type: 'mdxTransclusion',
                    raw,
                    providerKey,
                    id,
                  } as any;
                }
                return undefined;
              },
              renderer(token: any) {
                return `<div class="mdx-transclusion" data-provider-key="${token.providerKey}" data-id="${token.id}">Loading...</div>`;
              },
            }
          : undefined,
      ].filter(Boolean) as MarkedExtension['extensions'],
    };
  }

  /**
   * 创建悬浮预览卡片 (DOM)
   */
  private createHoverCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'mdx-mention-hover-card';
    card.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      max-width: 320px;
      display: none;
      overflow: hidden;
      font-family: sans-serif;
    `;
    document.body.appendChild(card);
    return card;
  }

  /**
   * 显示悬浮预览 (针对已渲染的 DOM 元素)
   */
  private async showHoverPreview(element: HTMLElement, provider: MentionProvider, id: string): Promise<void> {
    if (!this.options.enableHoverPreview || !provider.getHoverPreview) {
      return;
    }

    try {
      const uri = `mdx://${provider.key}/${id}`;
      const preview = await provider.getHoverPreview(uri);

      if (!preview) return;

      if (!this.hoverCard) {
        this.hoverCard = this.createHoverCard();
      }

      this.hoverCard.innerHTML = `
        <div class="mdx-mention-hover-card__header" style="padding: 8px 12px; background: #f5f5f5; border-bottom: 1px solid #eee; font-weight: 600;">
            ${preview.icon || ''} ${preview.title}
        </div>
        <div class="mdx-mention-hover-card__content" style="padding: 12px;">
            ${preview.contentHTML}
        </div>
      `;

      const rect = element.getBoundingClientRect();

      // 简单的位置计算，防止溢出屏幕底部
      let top = rect.bottom + 5;
      if (top + 200 > window.innerHeight) {
        top = rect.top - this.hoverCard.offsetHeight - 5;
      }

      this.hoverCard.style.left = `${rect.left}px`;
      this.hoverCard.style.top = `${top}px`;
      this.hoverCard.style.display = 'block';
    } catch (error) {
      console.error('[MentionPlugin] Failed to load hover preview:', error);
    }
  }

  /**
   * 隐藏悬浮预览
   */
  private hideHoverPreview(): void {
    if (this.hoverCard) {
      this.hoverCard.style.display = 'none';
    }
  }

  /**
   * 处理内容嵌入：查找并填充所有由 Marked Renderer 生成的占位符
   */
  private async processTransclusions(element: HTMLElement): Promise<void> {
    if (!this.options.enableTransclusion) return;

    const placeholders = element.querySelectorAll<HTMLElement>(
      '.mdx-transclusion:not([data-transclusion-processed])'
    );

    for (const placeholder of Array.from(placeholders)) {
      placeholder.setAttribute('data-transclusion-processed', 'true');

      const providerKey = placeholder.dataset.providerKey;
      const id = placeholder.dataset.id;
      if (!providerKey || !id) continue;

      // 查找对应的 Provider
      const provider = this.options.providers.find((p) => p.key === providerKey);
      if (!provider?.getFullContent) continue;

      try {
        const content = await provider.getFullContent(id);
        placeholder.innerHTML = content;
        placeholder.classList.add('mdx-transclusion--loaded');

        // 递归处理：嵌入的内容里可能还有 Mention
        this.bindMentionInteractions(placeholder);
        await this.processTransclusions(placeholder);
      } catch (error) {
        console.error(`[MentionPlugin] Failed to process transclusion for ${providerKey}:${id}:`, error);
        placeholder.textContent = 'Failed to load content';
        placeholder.classList.add('mdx-transclusion--error');
      }
    }
  }

  /**
   * 在指定元素范围内绑定提及的交互事件（悬浮、点击）
   */
  private bindMentionInteractions(element: HTMLElement): void {
    if (this.options.enableHoverPreview) {
      const mentionLinks = element.querySelectorAll<HTMLElement>('.mdx-mention');
      mentionLinks.forEach((link) => {
        if (link.dataset.eventsBound) return;
        link.dataset.eventsBound = 'true';

        const providerKey = link.dataset.provider;
        const id = link.dataset.id;
        const provider = this.options.providers.find((p) => p.key === providerKey);

        if (provider && id) {
          link.addEventListener('mouseenter', () => {
            this.showHoverPreview(link, provider, id);
          });
          link.addEventListener('mouseleave', () => {
            this.hideHoverPreview();
          });
        }
      });
    }

    if (this.options.enableClickHandler && !element.dataset.clickListenerBound) {
      element.dataset.clickListenerBound = 'true';
      element.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.mdx-mention');
        if (!target) return;

        // 阻止默认链接跳转，改用回调
        e.preventDefault();
        const providerKey = target.dataset.provider;
        const id = target.dataset.id;

        if (providerKey && id) {
          this.options.onMentionClick(providerKey, id);
        }
      });
    }
  }

  install(context: PluginContext): void {
    this.autocompletePlugin.install(context);

    context.registerSyntaxExtension(this.createMarkedExtension());

    const removeDomUpdated = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      this.bindMentionInteractions(element);
      await this.processTransclusions(element);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];

    if (this.hoverCard) {
      this.hoverCard.remove();
      this.hoverCard = null;
    }
  }
}
