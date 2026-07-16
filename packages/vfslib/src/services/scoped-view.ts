/**
 * @file packages/vfslib/src/services/scoped-view.ts
 * @desc chroot 路径映射
 *
 * 模块看到的文件系统:
 *   /         → /module/<moduleId>/
 *   /dev/     → /dev/  （只读）
 *   /etc/     → /etc/  （只读）
 */

import * as P from '../utils/path';

interface MountMapping {
    readonly virtualPrefix: string;
    readonly realPrefix: string;
    readonly readOnly: boolean;
}

export class ScopedView {
    private readonly mappings: readonly MountMapping[];

    constructor(readonly moduleId: string, rootRealPath?: string) {
        this.mappings = Object.freeze([
            { virtualPrefix: '/dev', realPrefix: '/dev', readOnly: true },
            { virtualPrefix: '/etc', realPrefix: '/etc', readOnly: true },
            { virtualPrefix: '/', realPrefix: rootRealPath ?? `/module/${moduleId}`, readOnly: false },
        ]);
    }

    toRealPath(virtualPath: string): string {
        const normalized = P.normalize(virtualPath);
        for (const m of this.mappings) {
            if (m.virtualPrefix !== '/' && P.isUnder(normalized, m.virtualPrefix)) {
                const rel = P.relative(m.virtualPrefix, normalized);
                return rel ? P.join(m.realPrefix, rel) : m.realPrefix;
            }
        }
        // Root mount — everything else maps to /module/<id>/
        const rootMapping = this.mappings[this.mappings.length - 1];
        const rel = P.relative('/', normalized);
        return rel ? P.join(rootMapping.realPrefix, rel) : rootMapping.realPrefix;
    }

    toVirtualPath(realPath: string): string {
        const normalized = P.normalize(realPath);
        for (const m of this.mappings) {
            if (P.isUnder(normalized, m.realPrefix)) {
                const rel = P.relative(m.realPrefix, normalized);
                return rel ? P.join(m.virtualPrefix, rel) : m.virtualPrefix;
            }
        }
        return normalized;
    }

    isReadOnly(virtualPath: string): boolean {
        const normalized = P.normalize(virtualPath);
        for (const m of this.mappings) {
            if (m.virtualPrefix !== '/' && P.isUnder(normalized, m.virtualPrefix)) {
                return m.readOnly;
            }
        }
        return false;
    }

    // Check read-only by real path to avoid virtual-path ambiguity (e.g. a
    // module-owned '/module/<id>/dev' dir has virtual path '/dev' which would
    // incorrectly match the system '/dev' read-only mapping).
    isRealPathReadOnly(realPath: string): boolean {
        const normalized = P.normalize(realPath);
        for (const m of this.mappings) {
            if (m.virtualPrefix !== '/' && P.isUnder(normalized, m.realPrefix)) {
                return m.readOnly;
            }
        }
        return false;
    }
}
