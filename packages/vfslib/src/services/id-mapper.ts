/**
 * @file packages/vfslib/src/services/id-mapper.ts
 * @desc 全局 ID ⟷ (mountId, ino) 映射工具
 *
 * ID 格式: `${mountId}:${ino}` — 简单且可逆
 */

export function encodeId(mountId: string, ino: number): string {
    return `${mountId}:${ino}`;
}

export function decodeId(id: string): { mountId: string; ino: number } | null {
    const sep = id.lastIndexOf(':');
    if (sep === -1) return null;
    const ino = parseInt(id.slice(sep + 1), 10);
    if (isNaN(ino)) return null;
    return { mountId: id.slice(0, sep), ino };
}
