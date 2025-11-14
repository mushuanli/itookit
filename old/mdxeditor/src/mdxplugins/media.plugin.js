/**
 * @file #mdxeditor/mdxplugins/media.plugin.js
 * @desc Media Plugin
 * Handles custom media syntaxes like `!video[...]...` and `!file[...]...`.
 * Since Marked.js parses these as standard images, this plugin uses the `afterRender`
 * hook to find the generated `<img>` tags and replace them with the correct HTML
 * for `<video>` or `<a>` tags.
 */

// --- [订正] 在文件顶部定义类型别名 ---
/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */

import { escapeHTML } from '@itookit/common';

export class MediaPlugin {
    name = 'feature:media';

    /**
     * @param {PluginContext} context // <-- [订正] 使用别名
     */
    install(context) {
        context.on('afterRender', ({ html, options }) => {
            let processedHtml = html;

            // Find image tags with alt text matching our video syntax
            processedHtml = processedHtml.replace(/<img src="([^"]+)" alt="video\[(.*?)\]" ?\/?>/g,
                (match, url, title) =>
                `<div class="media-container"><video controls title="${escapeHTML(title)}"><source src="${escapeHTML(url)}"></video></div>`
            );

            // Find image tags with alt text matching our file syntax
            processedHtml = processedHtml.replace(/<img src="([^"]+)" alt="file\[(.*?)\]" ?\/?>/g,
                (match, url, filename) =>
                `<a href="${escapeHTML(url)}" class="media-attachment" download="${escapeHTML(filename)}"><i class="fas fa-paperclip"></i> ${escapeHTML(filename)}</a>`
            );

            return { html: processedHtml, options };
        });
    }
}
