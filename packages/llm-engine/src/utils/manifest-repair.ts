// @file: llm-engine/src/utils/manifest-repair.ts
//
// @deprecated S4: Append-only Log invariant makes manifest-repair unnecessary.
//             Once data model fully migrates to Turn DAG (ULID + parents[]),
//             no repair is needed. Remove call sites in ChatEngine when ready.

import { ChatManifest } from '../persistence/types';
import { log } from './logger';

/**
 * Manifest 修复结果
 *
 * @deprecated S4: See file-level comment.
 */
export interface RepairResult {
    repaired: boolean;
    repairs: string[];
}

/**
 * Manifest 读写适配器
 * 解耦 manifest 修复逻辑与具体的 engine 实现
 */
export interface ManifestIO {
    getManifest(nodeId: string): Promise<ChatManifest>;
    writeManifest(nodeId: string, manifest: ChatManifest): Promise<void>;
}

/**
 * 通用 Manifest 修复器
 *
 * 统一 repairManifestAfterDelete / repairManifestAfterBatchDelete /
 * validateManifest / cleanupManifestReferences 四处重复逻辑。
 *
 * 调用方只需提供两个策略函数：
 *  - isInvalid: 判断某个 nodeId 是否无效
 *  - findFallback: 为无效节点查找回退目标
 */
export async function repairManifest(
    io: ManifestIO,
    nodeId: string,
    isInvalid: (id: string) => Promise<boolean>,
    findFallback: (invalidId: string, manifest: ChatManifest) => Promise<string>
): Promise<RepairResult> {
    const manifest = await io.getManifest(nodeId);
    let needsUpdate = false;
    const repairs: string[] = [];

    // 1. 修复 current_head
    if (await isInvalid(manifest.current_head)) {
        const newHead = await findFallback(manifest.current_head, manifest);
        repairs.push(`current_head: ${manifest.current_head} -> ${newHead}`);
        manifest.current_head = newHead;
        manifest.branches[manifest.current_branch] = newHead;
        needsUpdate = true;
    }

    // 2. 修复所有分支 heads
    for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
        if (branchName === manifest.current_branch) continue;

        if (await isInvalid(branchHead)) {
            const newHead = await findFallback(branchHead, manifest);
            manifest.branches[branchName] = newHead;
            repairs.push(`branch "${branchName}": ${branchHead} -> ${newHead}`);
            needsUpdate = true;
        }
    }

    // 3. 删除无效分支（分支 head 回退到 root 后仍无效的情况）
    const validBranches: Record<string, string> = {};
    for (const [name, head] of Object.entries(manifest.branches)) {
        if (!(await isInvalid(head))) {
            validBranches[name] = head;
        } else {
            repairs.push(`branch "${name}" removed (still invalid after fallback)`);
            needsUpdate = true;
        }
    }
    manifest.branches = validBranches;

    // 4. 确保至少有一个有效分支
    if (Object.keys(manifest.branches).length === 0) {
        manifest.branches['main'] = manifest.root_id;
        manifest.current_branch = 'main';
        manifest.current_head = manifest.root_id;
        needsUpdate = true;
        repairs.push('no valid branches, created main');
    }

    // 5. 写回
    if (needsUpdate) {
        manifest.updated_at = new Date().toISOString();
        await io.writeManifest(nodeId, manifest);
        log.info('Manifest repaired', { repairs });
    }

    return { repaired: needsUpdate, repairs };
}
