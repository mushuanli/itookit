/**
 * @file vfslib/src/file-io/ChatFileIO.ts
 * @desc Concrete implementation of IChatFileIO.
 *
 * Extends FileIO with chat-file–specific operations.
 * Message nodes are stored as "<nodeId>.chat" files in the companion assetdir.
 * The manifest lives in the main .chat file (this.nodeId).
 */
import YAML from 'yaml';
import { FileIO } from './FileIO';
import type { ISessionEngine, IChatFileIO } from '@itookit/common';
import type {
    ChatManifest,
    ChatNode,
    BranchTreeNode,
    ChatSessionSettings,
} from '@itookit/common';
import { DEFAULT_SESSION_SETTINGS } from '@itookit/common';
import { toString } from '../utils/encoding';

const SETTINGS_FILENAME = 'settings.yaml';

export class ChatFileIO extends FileIO implements IChatFileIO {
    constructor(engine: ISessionEngine, nodeId: string) {
        super(engine, nodeId);
    }

    // ========== Manifest ==========

    async getManifest(): Promise<ChatManifest> {
        const content = await this.engine.readContent(this.nodeId);
        const str = typeof content === 'string' ? content : toString(content as ArrayBuffer);
        return JSON.parse(str) as ChatManifest;
    }

    async updateManifest(patch: Partial<ChatManifest>, existing?: ChatManifest): Promise<void> {
        const base = existing ?? await this.getManifest();
        const updated: ChatManifest = { ...base, ...patch, updated_at: new Date().toISOString() };
        await this.engine.writeContent(this.nodeId, JSON.stringify(updated, null, 2));
    }

    // ========== Messages ==========

    async writeMessage(nodeId: string, node: ChatNode): Promise<void> {
        // _writeRawAsset: internal storage, not a user-facing embedded asset.
        await this._writeRawAsset(`${nodeId}.chat`, JSON.stringify(node));
    }

    async readMessage(nodeId: string): Promise<ChatNode | null> {
        const data = await this.getAsset(`${nodeId}.chat`);
        if (!data) return null;
        try {
            return JSON.parse(toString(data)) as ChatNode;
        } catch {
            return null;
        }
    }

    async deleteMessage(nodeId: string): Promise<void> {
        const node = await this.readMessage(nodeId);
        if (!node || node.status === 'deleted') return;
        node.status = 'deleted';
        await this.writeMessage(nodeId, node);
    }

    async updateMessage(nodeId: string, updates: Partial<ChatNode>): Promise<void> {
        const node = await this.readMessage(nodeId);
        if (!node) return;
        await this.writeMessage(nodeId, { ...node, ...updates });
    }

    async walkMessageChain(fromNodeId: string): Promise<ChatNode[]> {
        const chain: ChatNode[] = [];
        let currentId: string | null = fromNodeId;
        const visited = new Set<string>();

        while (currentId) {
            if (visited.has(currentId)) break;
            visited.add(currentId);

            const node = await this.readMessage(currentId);
            if (!node) break;

            if (node.status === 'active') chain.push(node);
            currentId = node.parent_id;
        }

        return chain.reverse();
    }

    async getSiblings(nodeId: string): Promise<ChatNode[]> {
        const node = await this.readMessage(nodeId);
        if (!node || !node.parent_id) return node ? [node] : [];

        const parent = await this.readMessage(node.parent_id);
        if (!parent) return [node];

        const siblings = await Promise.all(parent.children_ids.map((id) => this.readMessage(id)));
        return siblings.filter((n): n is ChatNode => n !== null && n.status === 'active');
    }

    // ========== Branches ==========

    async createBranch(name: string, fromNodeId: string): Promise<void> {
        const manifest = await this.getManifest();
        if (manifest.branches[name]) throw new Error(`Branch already exists: ${name}`);
        manifest.branches[name] = fromNodeId;
        await this.updateManifest({ branches: manifest.branches }, manifest);
    }

    async switchBranch(name: string): Promise<void> {
        const manifest = await this.getManifest();
        if (!manifest.branches[name]) throw new Error(`Branch not found: ${name}`);
        await this.updateManifest(
            { current_branch: name, current_head: manifest.branches[name] },
            manifest,
        );
    }

    async getBranchTree(): Promise<BranchTreeNode> {
        const manifest = await this.getManifest();
        const [activePathIds, branchMembership] = await Promise.all([
            this._collectActivePathIds(manifest.current_head),
            this._buildBranchMembership(manifest),
        ]);
        const headToBranch = new Map(
            Object.entries(manifest.branches).map(([name, headId]) => [headId, name])
        );
        return this._buildTreeNode(manifest.root_id, activePathIds, branchMembership, headToBranch);
    }

    async getCurrentBranch(): Promise<string> {
        return (await this.getManifest()).current_branch;
    }

    // ========== User assets ==========

    async putUserAsset(name: string, content: ArrayBuffer): Promise<string> {
        return this.putAsset(name, content);
    }

    async listUserAssets(): Promise<string[]> {
        const all = await this.listAssets();
        return all.filter((name) => !name.endsWith('.chat') && name !== SETTINGS_FILENAME);
    }

    // ========== Settings ==========

    async getSettings(): Promise<ChatSessionSettings> {
        try {
            const data = await this.getAsset(SETTINGS_FILENAME);
            if (!data) return { ...DEFAULT_SESSION_SETTINGS };
            return { ...DEFAULT_SESSION_SETTINGS, ...YAML.parse(toString(data)) };
        } catch {
            return { ...DEFAULT_SESSION_SETTINGS };
        }
    }

    async saveSettings(settings: Partial<ChatSessionSettings>): Promise<void> {
        const current = await this.getSettings();
        const merged: ChatSessionSettings = {
            ...current,
            ...settings,
            version: '1.0',
            updatedAt: new Date().toISOString(),
        };
        await this.putAsset(SETTINGS_FILENAME, YAML.stringify(merged, { indent: 2, lineWidth: 0 }));
    }

    // ========== Private helpers ==========

    private async _collectActivePathIds(headNodeId: string): Promise<Set<string>> {
        const ids = new Set<string>();
        let currentId: string | null = headNodeId;
        const visited = new Set<string>();

        while (currentId) {
            if (visited.has(currentId)) break;
            visited.add(currentId);
            ids.add(currentId);

            const node = await this.readMessage(currentId);
            if (!node) break;
            currentId = node.parent_id;
        }
        return ids;
    }

    private async _buildBranchMembership(manifest: ChatManifest): Promise<Map<string, Set<string>>> {
        const membership = new Map<string, Set<string>>();

        await Promise.all(
            Object.entries(manifest.branches).map(async ([branchName, headId]) => {
                let currentId: string | null = headId;
                const visited = new Set<string>();

                while (currentId) {
                    if (visited.has(currentId)) break;
                    visited.add(currentId);

                    if (!membership.has(currentId)) membership.set(currentId, new Set());
                    membership.get(currentId)!.add(branchName);

                    const node = await this.readMessage(currentId);
                    if (!node) break;
                    currentId = node.parent_id;
                }
            })
        );
        return membership;
    }

    private async _buildTreeNode(
        nodeId: string,
        activePathIds: Set<string>,
        branchMembership: Map<string, Set<string>>,
        headToBranch: Map<string, string>,
    ): Promise<BranchTreeNode> {
        const node = await this.readMessage(nodeId);
        if (!node) throw new Error(`ChatNode not found: ${nodeId}`);

        const childResults = await Promise.all(
            node.children_ids.map(async (childId) => {
                const child = await this.readMessage(childId);
                if (!child || child.status === 'deleted') return null;
                return this._buildTreeNode(childId, activePathIds, branchMembership, headToBranch);
            })
        );

        const memberBranches = branchMembership.get(nodeId);
        return {
            id: nodeId,
            role: node.role,
            content: node.content,
            timestamp: new Date(node.created_at).getTime(),
            isOnActivePath: activePathIds.has(nodeId),
            memberOfBranches: memberBranches ? Array.from(memberBranches) : [],
            branchHead: headToBranch.get(nodeId),
            createdFrom: node.meta?.branchCreatedFrom,
            children: childResults.filter((c): c is BranchTreeNode => c !== null),
        };
    }
}

export function createChatFileIO(engine: ISessionEngine, nodeId: string): IChatFileIO {
    return new ChatFileIO(engine, nodeId);
}
