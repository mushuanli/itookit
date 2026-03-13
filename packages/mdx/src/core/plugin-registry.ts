// @mdx/core/plugin-registry.ts
import type { MDxPlugin } from './types';

type MDxPluginConstructor = new (...args: any[]) => MDxPlugin;

export interface PluginRegistrationInfo {
    constructor: MDxPluginConstructor;
    priority: number;
    dependencies: string[];
}

export interface RegisterPluginOptions {
    priority?: number;
    dependencies?: string[];
}

/**
 * 插件注册表
 * 职责：全局插件类注册 + 拓扑排序
 * 从 factory.ts 中提取，符合 SRP
 */
export class PluginRegistry {
    private registry = new Map<string, PluginRegistrationInfo>();

    register(
        name: string,
        pluginClass: MDxPluginConstructor,
        options: RegisterPluginOptions = {}
    ): void {
        this.registry.set(name, {
            constructor: pluginClass,
            priority: options.priority ?? 100,
            dependencies: options.dependencies ?? [],
        });
    }

    get(name: string): PluginRegistrationInfo | undefined {
        return this.registry.get(name);
    }

    has(name: string): boolean {
        return this.registry.has(name);
    }

    /**
     * 基于 Kahn 算法的拓扑排序 + 优先级
     */
    sortByDependencies(pluginNames: string[]): string[] {
        const sorted: string[] = [];
        const inDegrees = new Map<string, number>();
        const graph = new Map<string, string[]>();

        // 初始化
        for (const name of pluginNames) {
            inDegrees.set(name, 0);
            graph.set(name, []);
        }

        // 构建依赖图
        for (const name of pluginNames) {
            const info = this.registry.get(name);
            if (!info) continue;

            for (const dep of info.dependencies) {
                if (pluginNames.includes(dep)) {
                    graph.get(dep)!.push(name);
                    inDegrees.set(name, (inDegrees.get(name) || 0) + 1);
                } else {
                    console.warn(`Plugin "${name}" depends on unloaded "${dep}", ignoring.`);
                }
            }
        }

        // BFS 拓扑排序，同层按优先级排序
        const queue: string[] = [];
        for (const name of pluginNames) {
            if (inDegrees.get(name) === 0) queue.push(name);
        }

        while (queue.length > 0) {
            // 只在取出时排序（修复原代码中的双重排序问题）
            queue.sort((a, b) => {
                const pa = this.registry.get(a)?.priority ?? 100;
                const pb = this.registry.get(b)?.priority ?? 100;
                return pa - pb;
            });

            const current = queue.shift()!;
            sorted.push(current);

            for (const neighbor of graph.get(current) || []) {
                const newDegree = (inDegrees.get(neighbor) || 1) - 1;
                inDegrees.set(neighbor, newDegree);
                if (newDegree === 0) queue.push(neighbor);
            }
        }

        // 处理循环依赖的残留
        if (sorted.length !== pluginNames.length) {
            const remaining = pluginNames.filter(p => !sorted.includes(p));
            console.warn(`Circular dependency detected: ${remaining.join(', ')}`);
            remaining.sort((a, b) => {
                const pa = this.registry.get(a)?.priority ?? 100;
                const pb = this.registry.get(b)?.priority ?? 100;
                return pa - pb;
            });
            sorted.push(...remaining);
        }

        return sorted;
    }
}

// === 全局单例 ===
export const globalPluginRegistry = new PluginRegistry();
