/**
 * #mdx/editor/plugins/media.plugin.js
 * @file Media Plugin
 * Handles custom media syntaxes like `!video[...]...` and `!file[...]...`.
 * Since Marked.js parses these as standard images, this plugin uses the `afterRender`
 * hook to find the generated `<img>` tags and replace them with the correct HTML
 * for `<video>` or `<a>` tags.
 */

import { escapeHTML } from '../../../common/utils/utils.js';

export class MediaPlugin {
    name = 'feature:media';

    /**
     * @param {import('../core/plugin.js').PluginContext} context
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
