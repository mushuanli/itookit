/**
 * @file mdxeditor/mdxplugins/codeblock-controls.plugin.js
 * @description Enhances rendered <pre> blocks with controls for copy, download, and collapse.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */

export class CodeBlockControlsPlugin {
    name = 'feature:codeblock-controls';

    /**
     * @param {object} [options]
     * @param {number} [options.collapseThreshold=250] - The height in pixels after which the collapse button appears.
     */
    constructor(options = {}) {
        this.collapseThreshold = options.collapseThreshold || 250;
    }

    /**
     * @param {PluginContext} context
     */
    install(context) {
        context.on('domUpdated', ({ element }) => {
            this.enhanceCodeBlocks(element);
        });
    }

    /**
     * Finds all <pre> elements and adds control buttons.
     * @param {HTMLElement} container - The root element of the rendered content.
     * @private
     */
    enhanceCodeBlocks(container) {
        const pres = container.querySelectorAll('pre:not([data-enhanced])');

        pres.forEach(pre => {
            pre.setAttribute('data-enhanced', 'true');

            const codeEl = pre.querySelector('code');
            if (!codeEl) return;

            const langMatch = codeEl.className.match(/language-(\S+)/);
            const language = langMatch ? langMatch[1] : 'Code';

            const wrapper = document.createElement('div');
            wrapper.className = 'mdx-code-block-wrapper';
            wrapper.dataset.language = language;
            
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            const controls = document.createElement('div');
            controls.className = 'mdx-code-block-controls';

            const copyBtn = this._createCopyButton(codeEl);
            const downloadBtn = this._createDownloadButton(codeEl);
            controls.appendChild(downloadBtn);
            controls.appendChild(copyBtn);

            if (pre.scrollHeight > this.collapseThreshold) {
                const collapseBtn = this._createCollapseButton(wrapper);
                controls.insertBefore(collapseBtn, controls.firstChild);
            }

            wrapper.insertBefore(controls, pre);
        });
    }

    /** @private */
    _createCopyButton(codeEl) {
        return this._createButton('fas fa-copy', 'Copy', (btn) => {
            navigator.clipboard.writeText(codeEl.textContent).then(() => {
                const originalIcon = btn.innerHTML;
                const originalTitle = btn.title;
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.title = 'Copied!';
                btn.classList.add('success');
                setTimeout(() => {
                    btn.innerHTML = originalIcon;
                    btn.title = originalTitle;
                    btn.classList.remove('success');
                }, 1500);
            }).catch(err => {
                btn.title = 'Copy failed!';
                console.error('Failed to copy text: ', err);
            });
        });
    }
    
    /** @private */
    _createDownloadButton(codeEl) {
        return this._createButton('fas fa-download', 'Download', () => {
            const langMatch = codeEl.className.match(/language-(\S+)/);
            const extension = langMatch ? langMatch[1] : 'txt';
            const filename = `code.${extension}`;
            const blob = new Blob([codeEl.textContent], { type: 'text/plain;charset=utf-t' });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            URL.revokeObjectURL(link.href);
        });
    }
    
    /** @private */
    _createCollapseButton(wrapper) {
        const btn = this._createButton('fas fa-compress-alt', 'Collapse code block', (btn) => {
            const isCollapsed = wrapper.classList.toggle('is-collapsed');
            if (isCollapsed) {
                btn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                btn.title = 'Expand code block';
            } else {
                btn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                btn.title = 'Collapse code block';
            }
        });
        return btn;
    }

    /** @private */
    _createButton(iconClass, title, onClick) {
        const btn = document.createElement('button');
        btn.className = 'mdx-code-block-btn';
        btn.title = title;
        btn.innerHTML = `<i class="${iconClass}"></i>`;
        btn.addEventListener('click', () => onClick(btn));
        return btn;
    }
}
