/**
 * #mdx/editor/plugins/mermaid.plugin.js
 * @file Mermaid Plugin
 * Finds and renders Mermaid diagrams within `<code>` blocks.
 * It hooks into the `domUpdated` lifecycle event to find the appropriate elements
 * and then calls the Mermaid.js API to render them.
 */
import mermaid from 'mermaid'; // <--- [修改] 导入 mermaid

export class MermaidPlugin {
    name = 'feature:mermaid';
    
    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        context.on('domUpdated', async ({ element }) => {
            // [修改] 不再检查 window.mermaid
            try {
                // 初始化 mermaid (如果需要配置)
                // mermaid.initialize({ startOnLoad: false }); 
                
                const mermaidElements = element.querySelectorAll('pre code.language-mermaid');
                if (mermaidElements.length > 0) {
                    await mermaid.run({ nodes: mermaidElements }); // <--- [修改] 使用导入的 mermaid
                }
            } catch (error) {
                console.error("Mermaid rendering failed:", error);
            }
        });
    }
}
