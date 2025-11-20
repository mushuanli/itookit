/**
 * @file mdx/plugins/syntax-extensions/media.plugin.ts
 * @desc 综合媒体插件，支持视频、文件下载及第三方内容嵌入 (PDF, Office, YouTube等)
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface MediaPluginOptions {
  /** 视频容器 CSS 类名 @default 'mdx-editor-video' */
  videoClassName?: string;
  /** 文件链接 CSS 类名 @default 'mdx-editor-file' */
  fileClassName?: string;
  /** 嵌入内容容器 CSS 类名 @default 'mdx-editor-embed' */
  embedClassName?: string;
  /** 视频是否显示控制条 @default true */
  videoControls?: boolean;
  /** 视频是否自动播放 @default false */
  videoAutoplay?: boolean;
  /** 文件图标类名 @default 'fas fa-paperclip' */
  fileIconClass?: string;
}

/** 防止 XSS */
function escapeHTML(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

export class MediaPlugin implements MDxPlugin {
  name = 'feature:media';
  private options: Required<MediaPluginOptions>;
  private cleanupFns: Array<() => void> = [];

  constructor(options: MediaPluginOptions = {}) {
    this.options = {
      videoClassName: options.videoClassName || 'mdx-editor-video',
      fileClassName: options.fileClassName || 'mdx-editor-file',
      embedClassName: options.embedClassName || 'mdx-editor-embed',
      videoControls: options.videoControls !== false,
      videoAutoplay: options.videoAutoplay === true,
      fileIconClass: options.fileIconClass || 'fas fa-paperclip',
    };
  }

  install(context: PluginContext): void {
    const removeAfterRender = context.on('afterRender', this.handleAfterRender.bind(this));
    if (removeAfterRender) {
      this.cleanupFns.push(removeAfterRender);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }

  private handleAfterRender({ html, options }: { html: string; options: any }) {
    let processedHtml = html;

    // 1. 处理 !video[...] 和 !file[...]
    // 匹配 Marked 渲染后的 <img src="..." alt="type[...]" />
    const imgTagRegex = /<img\s+[^>]*src="([^"]+)"[^>]*alt="((?:video|file)\[.*?\])"[^>]*\/?>/gi;

    processedHtml = processedHtml.replace(imgTagRegex, (match, src, altText) => {
      const typeMatch = altText.match(/^(video|file)\[(.*?)\]$/);
      if (!typeMatch) return match;

      const type = typeMatch[1];
      const title = this.decodeHTML(typeMatch[2]); // 解码 alt 中的实体字符

      if (type === 'video') {
        return this.renderVideo(src, title);
      } else if (type === 'file') {
        return this.renderFile(src, title);
      }
      return match;
    });

    // 2. 处理通用 Embeds (检测 ![embed](url) 或特定链接模式)
    // 这里假设用户使用 Markdown 图片语法 ![embed](url) 来触发嵌入
    const embedRegex = /<img\s+[^>]*src="([^"]+)"[^>]*alt="embed"[^>]*\/?>/gi;
    
    processedHtml = processedHtml.replace(embedRegex, (match, src) => {
      return this.renderEmbed(src);
    });

    return { html: processedHtml, options };
  }

  private renderVideo(src: string, title: string): string {
    const escapedSrc = escapeHTML(src);
    const escapedTitle = escapeHTML(title);
    const controls = this.options.videoControls ? 'controls' : '';
    const autoplay = this.options.videoAutoplay ? 'autoplay' : '';

    return `
      <div class="${this.options.videoClassName}">
        <video class="${this.options.videoClassName}__player" src="${escapedSrc}" title="${escapedTitle}" ${controls} ${autoplay}>
          您的浏览器不支持 HTML5 视频。
        </video>
        ${escapedTitle ? `<div class="${this.options.videoClassName}__title">${escapedTitle}</div>` : ''}
      </div>`;
  }

  private renderFile(href: string, filename: string): string {
    const escapedHref = escapeHTML(href);
    const escapedFilename = escapeHTML(filename);
    return `
      <a href="${escapedHref}" download="${escapedFilename}" class="${this.options.fileClassName}" title="下载 ${escapedFilename}" target="_blank" rel="noopener noreferrer">
        <i class="${this.options.fileIconClass}"></i>
        <span class="${this.options.fileClassName}__name">${escapedFilename}</span>
      </a>`;
  }

  private renderEmbed(url: string): string {
    let embedSrc = '';
    let extraClass = '';
    const lowerUrl = url.toLowerCase();

    // 1. PDF 预览
    if (lowerUrl.endsWith('.pdf')) {
      extraClass = 'mdx-embed-pdf'; // 特殊类名用于 CSS 设置高度
      return `
        <div class="${this.options.embedClassName} ${extraClass}">
          <iframe src="${url}" frameborder="0" title="PDF Preview">
            <p>您的浏览器不支持 PDF 预览，<a href="${url}">点击下载</a>。</p>
          </iframe>
        </div>`;
    }

    // 2. Office 文档 (Word, Excel, PPT) - 需公网可访问
    if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/.test(lowerUrl)) {
      extraClass = 'mdx-embed-office';
      // 使用微软 Office Web Viewer
      embedSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    }
    // 3. YouTube
    else if (url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)) {
      const id = RegExp.$1;
      embedSrc = `https://www.youtube.com/embed/${id}`;
    }
    // 4. Bilibili
    else if (url.match(/bilibili\.com\/video\/(BV[\w]+)/)) {
      const id = RegExp.$1;
      embedSrc = `https://player.bilibili.com/player.html?bvid=${id}&high_quality=1`;
    }

    if (embedSrc) {
      return `
        <div class="${this.options.embedClassName} ${extraClass}">
          <iframe src="${embedSrc}" frameborder="0" allowfullscreen scrolling="no"></iframe>
        </div>`;
    }

    // 无法识别的 Embed，降级为样式化的链接
    return `
      <a href="${url}" target="_blank" class="${this.options.fileClassName} mdx-embed-fallback">
        <i class="fas fa-external-link-alt"></i>
        <span class="${this.options.fileClassName}__name">打开外部链接: ${url}</span>
      </a>`;
  }

  /** 辅助：解码 HTML 实体 (用于处理 alt 文本) */
  private decodeHTML(html: string): string {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
  }
}
