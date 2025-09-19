// src/services/RenderService.js
class RenderService {
    constructor() {
        // 配置 Marked.js 等
        marked.setOptions({
            // ... options
        });
    }

    /**
     * 渲染包含 Markdown, Mermaid, MathJax 的内容
     * @param {string} rawContent 原始文本内容
     * @param {HTMLElement} targetElement 渲染的目标容器
     */
    async render(rawContent, targetElement) {
        targetElement.innerHTML = marked.parse(rawContent);

        // 异步处理 Mermaid
        const mermaidGraphs = targetElement.querySelectorAll('.language-mermaid');
        if (mermaidGraphs.length > 0) {
            // Mermaid V10+ initialize is called automatically
            await mermaid.run({ nodes: mermaidGraphs });
        }

        // 异步处理 MathJax
        if (window.MathJax) {
            // Clear previous typesetting and then typeset the new content
            MathJax.typesetClear([targetElement]);
            MathJax.typesetPromise([targetElement]).catch(err => console.error("MathJax typesetting failed:", err));
        }
    }
}

export const renderService = new RenderService();
