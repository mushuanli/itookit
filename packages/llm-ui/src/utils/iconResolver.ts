// @file: llm-ui/utils/iconResolver.ts

import { ExecutionNode } from '@itookit/llm-engine';

/**
 * Agent/Node 图标解析器
 * 
 * 统一的图标决策逻辑，消除 NodeRenderer 和 SessionRenderer 中的重复
 */
export class IconResolver {
    private static readonly TYPE_ICONS: Record<string, string> = {
        agent: '🤖',
        tool: '🔧',
        composite: '🔀',
        http: '🌐',
        script: '📜',
    };

    /**
     * 从 ExecutionNode 获取显示图标
     * 
     * 优先级：
     * 1. metaInfo.agentIcon（配置指定）
     * 2. executorType 映射
     * 3. 默认 📄
     */
    static getIcon(node: ExecutionNode): string {
        if (node.data.metaInfo?.agentIcon) {
            return node.data.metaInfo.agentIcon;
        }

        if (node.data.metaInfo?.agentId === 'default') {
            return '🤖';
        }

        return this.TYPE_ICONS[node.executorType] || '📄';
    }

    /**
     * 仅根据类型获取图标（无 node 实例时）
     */
    static getIconByType(executorType: string): string {
        return this.TYPE_ICONS[executorType] || '🤖';
    }

    /**
     * 获取 CSS 布局类
     */
    static getLayoutClass(node: ExecutionNode): string {
        const mode = node.data.metaInfo?.executionMode;
        if (mode === 'concurrent') return 'llm-ui-layout--grid';
        return 'llm-ui-layout--list';
    }
}
