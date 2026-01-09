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
  
  // [优化] 缓存 provider 查找
  private providerMap = new Map<string, MentionProvider>();
  
  // [优化] 防抖 hover
  private hoverDebounceTimer: number | null = null;

  constructor(options: MentionPluginOptions) {
    this.options = {
      providers: options.providers || [], 
      enableHoverPreview: options.enableHoverPreview !== false,
      enableClickHandler: options.enableClickHandler !== false,
      enableTransclusion: options.enableTransclusion !== false,
      onMentionClick: options.onMentionClick || (() => {}),
    };
    
    // 构建 provider 查找表
    for (const provider of this.options.providers) {
      this.providerMap.set(provider.key, provider);
    }

    // 1. 按 triggerChar 对 Provider 进行分组
    // 解决多个 Provider 使用相同触发字符（如 '@'）时只有第一个生效的问题
    const groupedProviders = new Map<string, MentionProvider[]>();

    // ✅ 修复 2: 只有在有 providers 时才执行遍历 (虽然有了修复1，这个判断是多余的，但更安全)
    if (this.options.providers && this.options.providers.length > 0) {
      this.options.providers.forEach((provider) => {
        if (!groupedProviders.has(provider.triggerChar)) {
          groupedProviders.set(provider.triggerChar, []);
        }
        groupedProviders.get(provider.triggerChar)!.push(provider);
      });
    }

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
            const provider = this.providerMap.get(providerKey);

            if (provider?.getHoverPreview) {
              const uri = `mdx://${providerKey}/${mentionItem.id}`;
              return provider.getHoverPreview(uri);
            }
            return null;
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
   * [优化] 懒加载创建 hover card
   */
  private getOrCreateHoverCard(): HTMLElement {
    if (!this.hoverCard) {
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
      this.hoverCard = card;
    }
    return this.hoverCard;
  }

  /**
   * 显示悬浮预览 (针对已渲染的 DOM 元素)
   */
  private showHoverPreview(
    element: HTMLElement, 
    provider: MentionProvider, 
    id: string
  ): void {
    if (!this.options.enableHoverPreview || !provider.getHoverPreview) {
      return;
    }
  // 保存引用以在闭包中使用
  const getHoverPreview = provider.getHoverPreview.bind(provider);

    // 清除之前的防抖定时器
    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
    }

    // 延迟显示，避免快速滑过时的闪烁
    this.hoverDebounceTimer = window.setTimeout(async () => {
      try {
        const uri = `mdx://${provider.key}/${id}`;
      const preview = await getHoverPreview(uri);

        if (!preview) return;

        const card = this.getOrCreateHoverCard();

        card.innerHTML = `
          <div class="mdx-mention-hover-card__header" style="padding: 8px 12px; background: #f5f5f5; border-bottom: 1px solid #eee; font-weight: 600;">
            ${preview.icon || ''} ${preview.title}
          </div>
          <div class="mdx-mention-hover-card__content" style="padding: 12px;">
            ${preview.contentHTML}
          </div>
        `;

        const rect = element.getBoundingClientRect();

        // 计算位置，避免溢出
        let top = rect.bottom + 5;
        const cardHeight = card.offsetHeight || 200;
        
        if (top + cardHeight > window.innerHeight) {
          top = rect.top - cardHeight - 5;
        }

        // 确保不超出左右边界
        let left = rect.left;
        const cardWidth = card.offsetWidth || 320;
        
        if (left + cardWidth > window.innerWidth) {
          left = window.innerWidth - cardWidth - 10;
        }
        if (left < 10) {
          left = 10;
        }

        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.display = 'block';
      } catch (error) {
        console.error('[MentionPlugin] Failed to load hover preview:', error);
      }
    }, 150); // 150ms 防抖延迟
  }

  /**
   * 隐藏悬浮预览
   */
  private hideHoverPreview(): void {
    // 清除防抖定时器
    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }
    
    if (this.hoverCard) {
      this.hoverCard.style.display = 'none';
    }
  }

  /**
   * [优化] 处理内容嵌入 - 使用并发限制
   */
  private async processTransclusions(element: HTMLElement): Promise<void> {
    if (!this.options.enableTransclusion) return;

    const placeholders = element.querySelectorAll<HTMLElement>(
      '.mdx-transclusion:not([data-transclusion-processed])'
    );

    if (placeholders.length === 0) return;

    // 并发限制
    const concurrencyLimit = 3;
    const queue = Array.from(placeholders);
    
    const processItem = async (placeholder: HTMLElement) => {
      placeholder.setAttribute('data-transclusion-processed', 'true');

      const providerKey = placeholder.dataset.providerKey;
      const id = placeholder.dataset.id;
      if (!providerKey || !id) return;

      const provider = this.providerMap.get(providerKey);
      if (!provider?.getFullContent) return;

      try {
        const content = await provider.getFullContent(id);
        placeholder.innerHTML = content;
        placeholder.classList.add('mdx-transclusion--loaded');

        // 递归处理
        this.bindMentionInteractions(placeholder);
        await this.processTransclusions(placeholder);
      } catch (error) {
        console.error(`[MentionPlugin] Transclusion failed for ${providerKey}:${id}:`, error);
        placeholder.textContent = 'Failed to load content';
        placeholder.classList.add('mdx-transclusion--error');
      }
    };

    // 分批并发处理
    for (let i = 0; i < queue.length; i += concurrencyLimit) {
      const batch = queue.slice(i, i + concurrencyLimit);
      await Promise.all(batch.map(processItem));
    }
  }

  /**
   * [优化] 绑定交互事件 - 使用事件委托
   */
  private bindMentionInteractions(element: HTMLElement): void {
    // 使用事件委托处理点击
    if (this.options.enableClickHandler && !element.dataset.mentionClickBound) {
      element.dataset.mentionClickBound = 'true';
      
      const clickHandler = (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.mdx-mention');
        if (!target) return;

        e.preventDefault();
        const providerKey = target.dataset.provider;
        const id = target.dataset.id;

        if (providerKey && id) {
          this.options.onMentionClick(providerKey, id);
        }
      };
      
      element.addEventListener('click', clickHandler);
      this.cleanupFns.push(() => {
        element.removeEventListener('click', clickHandler);
      });
    }

    // 悬浮预览使用事件委托
    if (this.options.enableHoverPreview && !element.dataset.mentionHoverBound) {
      element.dataset.mentionHoverBound = 'true';
      
      const mouseenterHandler = (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.mdx-mention');
        if (!target) return;

        const providerKey = target.dataset.provider;
        const id = target.dataset.id;
        
        if (providerKey && id) {
          const provider = this.providerMap.get(providerKey);
          if (provider) {
            this.showHoverPreview(target, provider, id);
          }
        }
      };
      
      const mouseleaveHandler = (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.mdx-mention');
        if (target) {
          this.hideHoverPreview();
        }
      };
      
      element.addEventListener('mouseenter', mouseenterHandler, true);
      element.addEventListener('mouseleave', mouseleaveHandler, true);
      
      this.cleanupFns.push(() => {
        element.removeEventListener('mouseenter', mouseenterHandler, true);
        element.removeEventListener('mouseleave', mouseleaveHandler, true);
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
    // 清除防抖定时器
    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }
    
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];

    if (this.hoverCard) {
      this.hoverCard.remove();
      this.hoverCard = null;
    }
    
    this.providerMap.clear();
  }
}
