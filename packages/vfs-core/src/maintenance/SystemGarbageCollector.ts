/**
 * @file vfs-core/maintenance/SystemGarbageCollector.ts
 */
import { ISessionEngine, EngineNode,IDocumentAnalyzer, GCResult, DocumentInfo } from '@itookit/common'; // 确保你的 common 包有这些定义

export class SystemGarbageCollector {
    private analyzers: IDocumentAnalyzer[] = [];

    constructor(
        private engine: ISessionEngine
    ) {}

    /**
     * 注册分析器
     */
    registerAnalyzer(analyzer: IDocumentAnalyzer): void {
        this.analyzers.push(analyzer);
    }

    /**
     * 对指定模块执行全量 GC
     * @param moduleName 目标模块名
     * @param dryRun 是否仅模拟不删除
     */
    async cleanModule(moduleName: string, dryRun = false): Promise<GCResult> {
        console.log(`[GC] Starting analysis for module: ${moduleName} (DryRun: ${dryRun})`);
        
        // 1. 获取模块内所有节点 (假设 engine.search 支持无限制查询)
        // 使用 scope 限定在当前模块
        const allNodes = await this.engine.search({ 
            scope: [moduleName], 
            limit: 100000 // 足够大的数，或者实现分页获取
        });

        const assetsToCheck = new Map<string, EngineNode>(); // Key: AssetFilename, Value: Node
        const documents: EngineNode[] = [];

        // 2. 节点分类
        for (const node of allNodes) {
            if (this.isAssetNode(node)) {
                // 伴生资源：记录下来待查
                // 注意：这里简单的用 filename 做 key，假设同一个文档的伴生目录里不会有重名文件
                // 更严谨的做法是 map key = `docPath/assetName`，但目前逻辑是全局扫描
                // 为了简化，我们只检查被引用的文件名集合。
                assetsToCheck.set(node.name, node);
            } else {
                // 检查是否有支持的分析器
                const docInfo = this.toDocInfo(node);
                if (this.analyzers.some(a => a.supports(docInfo))) {
                    documents.push(node);
                }
            }
        }

        // 3. 构建引用图谱 (并发分析)
        const referencedFilenames = new Set<string>();
        const errors: Array<{ path: string, error: string }> = [];

        // 限制并发数可以使用 p-limit，这里简化为 Promise.all
        await Promise.all(documents.map(async (doc) => {
            try {
                const content = await this.engine.readContent(doc.id);
                if (!content) return; // 空文件跳过

                const docInfo = this.toDocInfo(doc);
                // 找到第一个支持的分析器
                const analyzer = this.analyzers.find(a => a.supports(docInfo));
                
                if (analyzer) {
                    const result = await analyzer.analyze(content, { filePath: doc.path });
                    result.references.forEach(ref => referencedFilenames.add(ref));
                }
            } catch (e: any) {
                console.warn(`[GC] Analyze failed for ${doc.path}:`, e);
                errors.push({ path: doc.path, error: e.message });
            }
        }));

        // 4. 识别孤儿 (Diff)
        const orphanIds: string[] = [];
        for (const [filename, node] of assetsToCheck) {
            // 如果该资源文件名从未在任何文档中出现过，则视为孤儿
            // 注意：这种简单的 Filename 匹配有误删风险 (如果两个不同文档引用了同名但不同的 asset)
            // 但在 "伴生目录" (.filename/xxx) 模式下，通常文件名是唯一的或者作用域限定的。
            // 如果要更安全，MarkdownAnalyzer 应该返回绝对路径或相对 doc 的路径，此处做路径匹配。
            // 鉴于目前的 MarkdownAnalyzer 返回的是纯文件名，我们暂时按文件名匹配。
            if (!referencedFilenames.has(filename)) {
                orphanIds.push(node.id);
            }
        }

        console.log(`[GC] Analysis done. Assets: ${assetsToCheck.size}, Referenced: ${referencedFilenames.size}, Orphans: ${orphanIds.length}`);

        // 5. 执行清理
        let deletedCount = 0;
        if (!dryRun && orphanIds.length > 0) {
            // 利用之前添加的批量删除接口 (VFSModuleEngine.delete -> batchDelete)
            await this.engine.delete(orphanIds);
            deletedCount = orphanIds.length;
        }

        return {
            totalAssets: assetsToCheck.size,
            deletedCount,
            orphans: orphanIds,
            errors
        };
    }

    // --- Helpers ---

    /**
     * 判断是否为伴生资源节点
     * 规则：路径中包含 /.xxx/ 结构的目录
     */
    private isAssetNode(node: EngineNode): boolean {
        // 排除自己是伴生目录本身的情况 (type check needed if node has type)
        // 简单的正则匹配路径
        if (!node.path) return false;
        // 匹配 /foo/.bar/baz.png 或 /.bar/baz.png
        return /\/\.[^/]+\//.test(node.path);
    }

    private toDocInfo(node: EngineNode): DocumentInfo {
        return {
            filename: node.name,
            path: node.path,
            mimeType: (node as any).metadata?.mimeType, // 假设 EngineNode metadata 有 mimeType
            size: (node as any).size
        };
    }
}
