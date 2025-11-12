// mdx/plugins/syntax-extensions/media.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';

/**
 * 媒体插件配置选项
 */
export interface MediaPluginOptions {
  /**
   * 视频容器的自定义CSS类名
   * @default 'mdx-editor-video'
   */
  videoClassName?: string;

  /**
   * 文件链接的自定义CSS类名
   * @default 'mdx-editor-file'
   */
  fileClassName?: string;

  /**
   * 视频默认控制选项
   * @default true
   */
  videoControls?: boolean;

  /**
   * 视频自动播放
   * @default false
   */
  videoAutoplay?: boolean;

  /**
   * 文件图标类名（Font Awesome等）
   * @default 'fas fa-paperclip'
   */
  fileIconClass?: string;
}

/**
 * HTML 转义函数（防止XSS攻击）
 */
function escapeHTML(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * 媒体插件（多实例安全）
 * 
 * 支持语法：
 * !video[视频标题](视频链接)
 * !file[文件名](文件链接)
 * 
 * 示例：
 * !video[产品演示](https://example.com/demo.mp4)
 * !file[用户手册](https://example.com/manual.pdf)
 */
export class MediaPlugin implements MDxPlugin {
  name = 'feature:media';
  private options: Required<MediaPluginOptions>;
  private cleanupFns: Array<() => void> = [];

  constructor(options: MediaPluginOptions = {}) {
    this.options = {
      videoClassName: options.videoClassName || 'mdx-editor-video',
      fileClassName: options.fileClassName || 'mdx-editor-file',
      videoControls: options.videoControls !== false,
      videoAutoplay: options.videoAutoplay === true,
      fileIconClass: options.fileIconClass || 'fas fa-paperclip',
    };
  }

  /**
   * 创建 afterRender 钩子（处理HTML字符串）
   */
  private createAfterRenderHook(context: PluginContext) {
    return ({ html, options }: { html: string; options: any }) => {
      let processedHtml = html;

      // 1. 处理视频语法：!video[标题](链接)
      // 匹配由Marked解析后的 <img src="..." alt="video[...]" />
      const videoRegex = /<img src="([^"]+)" alt="video\[(.*?)\]" ?\/?>/g;
      
      processedHtml = processedHtml.replace(videoRegex, (match, src, title) => {
        const escapedSrc = escapeHTML(src);
        const escapedTitle = escapeHTML(title);
        
        const controls = this.options.videoControls ? 'controls' : '';
        const autoplay = this.options.videoAutoplay ? 'autoplay' : '';

        return `<div class="${this.options.videoClassName}">
  <video 
    class="${this.options.videoClassName}__player" 
    src="${escapedSrc}" 
    title="${escapedTitle}"
    ${controls}
    ${autoplay}
  >
    您的浏览器不支持视频标签。
  </video>
  ${escapedTitle ? `<div class="${this.options.videoClassName}__title">${escapedTitle}</div>` : ''}
</div>`;
      });

      // 2. 处理文件附件语法：!file[文件名](链接)
      // 匹配由Marked解析后的 <img src="..." alt="file[...]" />
      const fileRegex = /<img src="([^"]+)" alt="file\[(.*?)\]" ?\/?>/g;
      
      processedHtml = processedHtml.replace(fileRegex, (match, href, filename) => {
        const escapedHref = escapeHTML(href);
        const escapedFilename = escapeHTML(filename);

        return `<a 
  href="${escapedHref}" 
  download="${escapedFilename}"
  class="${this.options.fileClassName}"
  title="下载 ${escapedFilename}"
>
  <i class="${this.options.fileIconClass}"></i>
  <span class="${this.options.fileClassName}__name">${escapedFilename}</span>
</a>`;
      });

      return {
        html: processedHtml,
        options,
      };
    };
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    const removeAfterRender = context.on('afterRender', this.createAfterRenderHook(context));
    if (removeAfterRender) {
      this.cleanupFns.push(removeAfterRender);
    }
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
