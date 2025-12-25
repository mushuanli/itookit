/**
 * @file mdx/plugins/ui/asset-manager.plugin.ts
 * @desc 集成 AssetManagerUI 并处理配置
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AssetManagerUI } from './asset-manager.ui';
import { resolveAssetDirectory, AssetConfigOptions } from '../../core/asset-helper';
import { Toast } from '@itookit/common';

// 插件选项继承自通用配置
export interface AssetManagerPluginOptions extends AssetConfigOptions {}

export class AssetManagerPlugin implements MDxPlugin {
    name = 'ui:asset-manager';
    private options: AssetManagerPluginOptions;

    constructor(options: AssetManagerPluginOptions = {}) {
        this.options = options;
    }

    install(context: PluginContext): void {
        context.registerTitleBarButton?.({
            id: 'asset-manager',
            title: '附件管理',
            icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`,
            location: 'right',
            onClick: async ({ editor }) => {
                // [修复] 安全获取 getSessionEngine 方法
                const getEngine = context.getSessionEngine;
                if (!getEngine) {
                    Toast.error('未连接到会话引擎');
                    return;
                }
                const engine = getEngine();
                
                // [修复] 将 null 转为 undefined，满足 AssetPathHelper 的类型要求
                const nodeId = context.getCurrentNodeId() ?? undefined;
                
                if (!engine) {
                    Toast.error('未连接到会话引擎');
                    return;
                }

                // ✨ 解析目录
                const assetDirId = await resolveAssetDirectory(engine, nodeId, this.options);

                if (!assetDirId) {
                    Toast.info('当前模式下没有关联的附件目录');
                    return;
                }

                // ✨ 调用独立 UI
                const ui = new AssetManagerUI(engine, editor);
                await ui.show(assetDirId);
            }
        });
    }
}