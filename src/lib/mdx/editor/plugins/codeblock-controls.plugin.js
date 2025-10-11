/**
 * #mdx/editor/plugins/codeblock-controls.plugin.js
 * @file [NEW] Enhances rendered <pre> blocks with controls for copy, download, and collapse.
 */

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
     * @param {import('../core/plugin.js').PluginContext} context
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
            // Mark as enhanced to prevent duplicate controls on re-renders
            pre.setAttribute('data-enhanced', 'true');

            const codeEl = pre.querySelector('code');
            if (!codeEl) return;

            // +++ START MODIFICATION +++
            // 0. Extract language for the collapsed label (UX improvement)
            const langMatch = codeEl.className.match(/language-(\S+)/);
            const language = langMatch ? langMatch[1] : 'Code';

            // 1. Create a wrapper for positioning and collapsed state styling
            const wrapper = document.createElement('div');
            wrapper.className = 'mdx-code-block-wrapper';
            // Store language in dataset for CSS ::before content
            wrapper.dataset.language = language;
            // +++ END MODIFICATION +++
            
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            // 2. Create the controls container
            const controls = document.createElement('div');
            controls.className = 'mdx-code-block-controls';

            // 3. Create and add buttons
            const copyBtn = this._createCopyButton(codeEl);
            const downloadBtn = this._createDownloadButton(codeEl);
            controls.appendChild(downloadBtn);
            controls.appendChild(copyBtn);

            // 4. Add collapse button only if content is tall enough
            if (pre.scrollHeight > this.collapseThreshold) {
                const collapseBtn = this._createCollapseButton(wrapper);
                controls.insertBefore(collapseBtn, controls.firstChild); // Add collapse at the beginning
            }

            // 5. Add controls to the wrapper
            wrapper.insertBefore(controls, pre);
        });
    }

    /** @private */
    _createCopyButton(codeEl) {
        return this._createButton('fas fa-copy', '复制', (btn) => {
            navigator.clipboard.writeText(codeEl.textContent).then(() => {
                const originalIcon = btn.innerHTML;
                const originalTitle = btn.title;
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.title = '已复制!';
                btn.classList.add('success');
                setTimeout(() => {
                    btn.innerHTML = originalIcon;
                    btn.title = originalTitle;
                    btn.classList.remove('success');
                }, 1500);
            }).catch(err => {
                btn.title = '复制失败!';
                console.error('Failed to copy text: ', err);
            });
        });
    }
    
    /** @private */
    _createDownloadButton(codeEl) {
        return this._createButton('fas fa-download', '下载', () => {
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
        // [UX微调] 修改初始 title
        const btn = this._createButton('fas fa-compress-alt', '折叠代码块', (btn) => {
            const isCollapsed = wrapper.classList.toggle('is-collapsed');
            if (isCollapsed) {
                btn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                btn.title = '展开代码块';
            } else {
                btn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                btn.title = '折叠代码块';
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
