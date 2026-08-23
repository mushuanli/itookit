/**
 * @file packages/vfs-core/src/impl/services/MaintenanceService.ts
 * @desc 维护子服务 — 统计 / gc / fsck / 备份 / 模块导入导出。
 *
 * 从 VFSManager 拆分（SRP）。通过 type-only 依赖 VFSManager 避免循环引用。
 */

import type {
    IMaintenanceService,
    FSNode,
    FSModuleStats,
    ModuleExportData,
    VFSSystemStats,
} from '../../protocol';
import { FSError } from '../../protocol';
import type { VFSManager } from './VFSManager';
import * as P from '../../utils/path';

export class MaintenanceService implements IMaintenanceService {
    constructor(private readonly manager: VFSManager) {}

    async getSystemStats(): Promise<VFSSystemStats> {
        const moduleStats: Record<string, FSModuleStats> = {};
        let totalFiles = 0;
        let totalSize = 0;

        for (const modName of this.manager._modules.keys()) {
            try {
                const eng = this.manager.getEngine(modName);
                const stats = await eng.driver.getStats?.();
                if (stats) {
                    moduleStats[modName] = stats;
                    totalFiles += stats.fileCount;
                    totalSize += stats.totalSize;
                }
            } catch {
                continue;
            }
        }

        return {
            moduleCount: this.manager._modules.size,
            modules: moduleStats,
            totalFiles,
            totalSize,
            mountCount: this.manager.mounts.listMounts().length,
            deviceCount: this.manager.devices.list().length,
            pluginCount: this.manager.plugins.list().length,
            storageBackend: this.manager._engine.getBackend().name,
        };
    }

    async gc(): Promise<{ cleaned: number; freedBytes: number }> {
        // Stub — a full implementation would scan orphaned content refs
        return { cleaned: 0, freedBytes: 0 };
    }

    async fsck(): Promise<{
        ok: boolean;
        errors: Array<{ path: string; issue: string; severity: 'warning' | 'error' }>;
    }> {
        const errors: Array<{ path: string; issue: string; severity: 'warning' | 'error' }> = [];

        for (const modName of this.manager._modules.keys()) {
            try {
                const eng = this.manager.getEngine(modName);
                await eng.driver.walkTree?.((node) => {
                    if (node.type === 'symlink' && !node.symlinkTarget) {
                        errors.push({
                            path: node.path,
                            issue: 'symlink has no target',
                            severity: 'error',
                        });
                    }
                }, { includeHidden: true });
            } catch (e) {
                errors.push({
                    path: '/module/' + modName,
                    issue: 'scan failed: ' + e,
                    severity: 'error',
                });
            }
        }

        return { ok: errors.length === 0, errors };
    }

    async createBackup(): Promise<string> {
        const backup: {
            version: number;
            createdAt: number;
            modules: Record<string, ModuleExportData>;
        } = {
            version: 1,
            createdAt: Date.now(),
            modules: {} as Record<string, ModuleExportData>,
        };

        for (const modName of this.manager._modules.keys()) {
            backup.modules[modName] = await this.exportModule(modName);
        }

        return JSON.stringify(backup);
    }

    async restoreBackup(jsonContent: string): Promise<void> {
        const backup = JSON.parse(jsonContent);
        if (backup.version !== 1) {
            throw new FSError('EINVAL', 'unsupported backup version: ' + backup.version, 'restore');
        }
        for (const data of Object.values(backup.modules)) {
            await this.importModule(data as ModuleExportData);
        }
    }

    async exportModule(moduleName: string): Promise<ModuleExportData> {
        const eng = this.manager.getEngine(moduleName);
        const nodes: FSNode[] = [];
        const contents: Record<string, string> = {};

        await eng.driver.walkTree?.((node) => {
            nodes.push(node);
        }, { includeHidden: true });

        const contentPromises: Promise<void>[] = [];
        for (const node of nodes) {
            if (node.type === 'file') {
                contentPromises.push(
                    eng.driver.readContent(node.path, { encoding: 'utf-8' })
                        .then(c => {
                            if (typeof c === 'string') contents[node.path] = c;
                        })
                        .catch(() => {}),
                );
            }
        }
        await Promise.all(contentPromises);

        return {
            version: 1,
            moduleName,
            exportedAt: Date.now(),
            nodes,
            contents,
        };
    }

    async importModule(data: ModuleExportData): Promise<void> {
        await this.manager.mount(data.moduleName);
        const eng = this.manager.getEngine(data.moduleName);

        // Sort: directories first, by depth
        const sorted = [...data.nodes].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return P.depth(a.path) - P.depth(b.path);
        });

        for (const node of sorted) {
            const parentPath = P.dirname(node.path);
            try {
                if (node.type === 'directory') {
                    await eng.driver.createDirectory({
                        name: node.name,
                        parentPath,
                        metadata: node.metadata ? { ...node.metadata } : undefined,
                        recursive: true,
                    });
                } else if (node.type === 'file' || node.type === 'seqfile') {
                    await eng.driver.createFile({
                        name: node.name,
                        parentPath,
                        content: data.contents[node.path],
                        metadata: node.metadata ? { ...node.metadata } : undefined,
                        tags: node.tags ? [...node.tags] : undefined,
                        type: node.type,
                        recursive: true,
                        overwrite: true,
                    });
                }
            } catch (e) {
                console.warn('[importModule] Failed to create ' + node.path + ':', e);
            }
        }
    }
}
