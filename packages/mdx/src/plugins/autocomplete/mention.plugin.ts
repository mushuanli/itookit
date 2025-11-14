
// mdx/plugins/autocomplete/mention.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AutocompletePlugin, AutocompleteProvider } from './autocomplete.plugin';
import type { Completion } from '@codemirror/autocomplete';
import type { MarkedExtension, Token } from 'marked';

/**
 * 提及项
 */
export interface MentionItem {
  id: string;
  label: string;
  type?: string;
  avatar?: string;
  [key: string]: any;
}

/**
 * 提及提供者接口
 */
export interface MentionProvider {
  /**
   * 提供者的唯一键（如 'users', 'documents'）
   */
  key: string;

  /**
   * 触发字符（如 '@', '@@'）
   */
  triggerChar: string;

  /**
   * 获取建议列表
   */
  getSuggestions(query: string): MentionItem[] | Promise<MentionItem[]>;

  /**
   * 获取悬浮预览内容
   */
  getHoverPreview?(item: MentionItem): Promise<{ title: string; content: string }>;

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

    // 创建自动完成插件
    const sources = this.options.providers.map((provider) => ({
      triggerChar: provider.triggerChar,
      provider: {
        getSuggestions: async (query: string): Promise<Completion[]> => {
          const items = await provider.getSuggestions(query);
          return items.map((item) => ({
            ...item,
            detail: item.type || provider.key,
            info: item.avatar,
          })) as Completion[];
        },
      },
      applyTemplate: (completion: Completion) => {
        const item = completion as MentionItem; 
        
        return `[${item.label}](mdx://${provider.key}/${item.id}) `;
      },
    }));

    this.autocompletePlugin = new AutocompletePlugin({ sources });
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
        this.options.enableTransclusion ? {
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
        } : undefined,
      ].filter(Boolean) as MarkedExtension['extensions'],
    };
  }

  /**
   * 创建悬浮预览卡片
   */
  private createHoverCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'mdx-mention-hover-card';
    card.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 1000;
      max-width: 300px;
      display: none;
    `;
    document.body.appendChild(card);
    return card;
  }

  /**
   * 显示悬浮预览
   */
  private async showHoverPreview(
    element: HTMLElement,
    provider: MentionProvider,
    id: string
  ): Promise<void> {
    if (!this.options.enableHoverPreview || !provider.getHoverPreview) return;

    try {
      const item = { id } as MentionItem;
      const preview = await provider.getHoverPreview(item);

      if (!this.hoverCard) {
        this.hoverCard = this.createHoverCard();
      }

      this.hoverCard.innerHTML = `
        <div class="mdx-mention-hover-card__title">${preview.title}</div>
        <div class="mdx-mention-hover-card__content">${preview.content}</div>
      `;

      const rect = element.getBoundingClientRect();
      this.hoverCard.style.left = `${rect.left}px`;
      this.hoverCard.style.top = `${rect.bottom + 5}px`;
      this.hoverCard.style.display = 'block';
    } catch (error) {
      console.error('Failed to load hover preview:', error);
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

      const provider = this.options.providers.find((p) => p.key === providerKey);
      if (!provider?.getFullContent) continue;

      try {
        const content = await provider.getFullContent(id);
        placeholder.innerHTML = content;
        placeholder.classList.add('mdx-transclusion--loaded');

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
          link.addEventListener('mouseenter', () => this.showHoverPreview(link, provider, id));
          link.addEventListener('mouseleave', () => this.hideHoverPreview());
        }
      });
    }

    if (this.options.enableClickHandler && !element.dataset.clickListenerBound) {
      element.dataset.clickListenerBound = 'true';
      element.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.mdx-mention');
        if (!target) return;

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

    const removeDomUpdated = context.on(
      'domUpdated',
      async ({ element }: { element: HTMLElement }) => {
        this.bindMentionInteractions(element);
        await this.processTransclusions(element);
      }
    );

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
