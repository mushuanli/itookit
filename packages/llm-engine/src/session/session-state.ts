// @file: llm-engine/session/session-state.ts
//
// In-memory session projection cache (Turn DAG format).
// Updated via apply(TurnLogEvent); consumed by UI via getSessions().

import type { TurnId } from '@itookit/common';
import type { TurnProjection } from '../persistence/turn-types';
import type { TurnLogEvent } from '../persistence/turn-events';
import { NodeStatus } from '../core/types';
import {
    SessionGroup,
    ExecutionNode,
    ChatAttachment,
    SessionOrigin,
    HistoryPolicy,
} from '../core/types';
import type { SessionEvent } from '../core/types';

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
    files?: ChatAttachment[];
}

export class SessionState {
    // ── Legacy-format storage (ChatNode sessions) ──────────────────────
    private sessions: SessionGroup[] = [];

    // ── Turn-format storage (Turn DAG) ─────────────────────────────────
    private turns: TurnProjection[] = [];
    private turnById = new Map<TurnId, TurnProjection>();
    /** Reverse index: parentTurnId → childTurnIds. Maintained incrementally. */
    private childrenByParent = new Map<TurnId, TurnId[]>();

    // ── Format flag ───────────────────────────────────────────────────
    private _isTurnFormat = true;

    constructor(
        private readonly _nodeId: string,
        private readonly _sessionId: string,
    ) {}

    // ================================================================
    // 访问器
    // ================================================================

    get nodeId(): string { return this._nodeId; }
    get sessionId(): string { return this._sessionId; }

    // ── Unified getSessions (adapter for UI) ─────────────────────────

    getSessions(): SessionGroup[] {
        if (this._isTurnFormat && this.turns.length > 0) return this.turnProjectionsToSessionGroups();
        return this.sessions;
    }

    getLastSession(): SessionGroup | undefined {
        const all = this.getSessions();
        return all[all.length - 1];
    }

    findSessionById(id: string): SessionGroup | undefined {
        return this.getSessions().find(s => s.id === id);
    }

    // ================================================================
    // Turn format: single mutation entry
    // ================================================================

    /**
     * Apply a TurnLogEvent to the in-memory projection.
     * Returns SessionEvent[] to be emitted by the caller.
     * Only effective when _isTurnFormat is true.
     */
    apply(event: TurnLogEvent): SessionEvent[] {

        switch (event.type) {
            case 'turn:appended': return this.applyAppended(event);
            case 'turn:updated': return this.applyUpdated(event);
            case 'turn:deleted': return this.applyDeleted(event);
        }
    }

    private applyAppended(event: TurnLogEvent & { type: 'turn:appended' }): SessionEvent[] {
        const { turnId, projection } = event;
        if (this.turnById.has(turnId)) return [];

        // First TurnProjection added: clear legacy sessions (superseded)
        if (this.turns.length === 0) {
            this.sessions = [];
        }

        this.turns.push(projection);
        this.turnById.set(turnId, projection);

        // Maintain childrenByParent reverse index
        for (const parentId of projection.parents) {
            if (!this.childrenByParent.has(parentId)) {
                this.childrenByParent.set(parentId, []);
            }
            const children = this.childrenByParent.get(parentId)!;
            if (!children.includes(turnId)) children.push(turnId);
        }

        const sessionGroups = this.turnProjectionToSessionGroups(projection);
        const isExecutionRoot = projection.kind === 'chat' && !!projection.assistantMessage;
        const parentId = projection.parents.length > 0 ? projection.parents[projection.parents.length - 1] : undefined;

        // Emit one message:appended per SessionGroup produced by this turn.
        // A chat turn with both user and assistant emits two events so both bubbles appear.
        const events: SessionEvent[] = [];
        let prevId: string | undefined = parentId;
        for (const sessionGroup of sessionGroups) {
            events.push({
                type: 'message:appended',
                payload: {
                    sessionGroup,
                    isExecutionRoot: isExecutionRoot && sessionGroup.role === 'assistant',
                    parentId: prevId,
                },
            });
            prevId = sessionGroup.id;
        }
        return events;
    }

    private applyUpdated(event: TurnLogEvent & { type: 'turn:updated' }): SessionEvent[] {
        const turn = this.turnById.get(event.turnId);
        if (!turn) return [];

        const { changes } = event;
        if (turn.assistantMessage) {
            if (changes.assistantContent !== undefined) {
                turn.assistantMessage.content = changes.assistantContent;
            }
            if (changes.thinking !== undefined) {
                turn.assistantMessage.thinking = changes.thinking;
            }
            if (changes.status !== undefined) {
                turn.assistantMessage.status = changes.status;
            }
        }
        if (turn.meta) {
            if (changes.stale !== undefined) turn.meta.stale = changes.stale;
        }

        const events: SessionEvent[] = [];
        if (changes.status && turn.assistantMessage) {
            events.push({
                type: 'message:status',
                payload: {
                    messageId: turn.assistantMessage.persistedNodeId,
                    status: changes.status,
                },
            });
        }
        return events;
    }

    private applyDeleted(event: TurnLogEvent & { type: 'turn:deleted' }): SessionEvent[] {
        const cascadeIds = event.cascadeIds ?? this.collectCascadeTurnIds(event.turnId);
        const idSet = new Set(cascadeIds);

        this.turns = this.turns.filter(t => !idSet.has(t.turnId));
        for (const id of cascadeIds) {
            this.turnById.delete(id);
            this.childrenByParent.delete(id);
        }
        // Clean parent index entries
        for (const [parentId, children] of this.childrenByParent) {
            this.childrenByParent.set(parentId, children.filter(c => !idSet.has(c)));
        }

        return [{
            type: 'messages:deleted',
            payload: { deletedIds: cascadeIds },
        }];
    }

    /** Collect all TurnIds that should be cascade-deleted when this turn is removed. */
    private collectCascadeTurnIds(turnId: TurnId): TurnId[] {
        const result = [turnId];
        const childIds = this.childrenByParent.get(turnId);
        if (childIds) {
            for (const childId of childIds) {
                result.push(...this.collectCascadeTurnIds(childId));
            }
        }
        return result;
    }

    // ================================================================
    // Turn format: O(1) index-based lookups
    // ================================================================

    /** Get the first parent turn of a given turn. */
    getParentTurn(turnId: TurnId): TurnProjection | undefined {
        const turn = this.turnById.get(turnId);
        if (!turn || turn.parents.length === 0) return undefined;
        return this.turnById.get(turn.parents[0]);
    }

    /**
     * Find the user-containing turn before an assistant turn.
     * Walks the parents chain until it finds a chat turn with a userMessage.
     */
    findUserTurnForAssistant(assistantId: TurnId): TurnProjection | undefined {
        let current = this.turnById.get(assistantId);
        while (current) {
            if (current.kind === 'chat' && current.userMessage) return current;
            if (current.parents.length === 0) return undefined;
            current = this.turnById.get(current.parents[0]);
        }
        return undefined;
    }

    /** Get child turn IDs via the reverse index (O(1)). */
    getChildTurnIds(turnId: TurnId): TurnId[] {
        return this.childrenByParent.get(turnId) ?? [];
    }

    /** Diff support: check if a turn is already in the projection. */
    hasTurn(turnId: TurnId): boolean {
        return this.turnById.has(turnId);
    }

    /** Get all turn projections (for diff computation). */
    getTurns(): TurnProjection[] {
        return this.turns;
    }

    // ================================================================
    // 从持久化加载
    // ================================================================

    /** Load a TurnProjection into the turn-format arrays. */
    loadFromProjection(projection: TurnProjection): void {
        this.turns.push(projection);
        this.turnById.set(projection.turnId, projection);
        for (const parentId of projection.parents) {
            if (!this.childrenByParent.has(parentId)) {
                this.childrenByParent.set(parentId, []);
            }
            const children = this.childrenByParent.get(parentId)!;
            if (!children.includes(projection.turnId)) children.push(projection.turnId);
        }
    }

    // ================================================================
    // Legacy format: 创建消息
    // ================================================================

    addUserMessage(
        text: string,
        files: ChatAttachment[],
        persistedNodeId: string,
        origin?: SessionOrigin,
        historyPolicy?: HistoryPolicy,
    ): SessionGroup {
        const session: SessionGroup = {
            id: persistedNodeId,
            persistedNodeId,
            role: 'user',
            content: text,
            files,
            timestamp: Date.now(),
            origin: origin ?? 'user',
            historyPolicy: historyPolicy ?? 'include',
        };
        this.sessions.push(session);
        return session;
    }

    // ================================================================
    // 更新
    // ================================================================

    updateMessageContent(messageId: string, newContent: string): void {
        const all = this.getSessions();
        const session = all.find(s => s.id === messageId);
        if (session) session.content = newContent;
    }

    appendToNode(nodeId: string, chunk: string, field: 'thought' | 'output'): void {
        for (const session of this.getSessions()) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) {
                    if (field === 'thought') {
                        node.data.thought = (node.data.thought || '') + chunk;
                    } else {
                        node.data.output = (node.data.output || '') + chunk;
                    }
                    return;
                }
            }
        }
    }

    updateNodeOutput(nodeId: string, content: string): void {
        for (const session of this.getSessions()) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) { node.data.output = content; return; }
            }
        }
    }

    updateNodeStatus(nodeId: string, status: NodeStatus): void {
        for (const session of this.getSessions()) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) { node.status = status; return; }
            }
        }
    }

    updateNodeError(nodeId: string, error: string): void {
        for (const session of this.getSessions()) {
            if (session.executionRoot) {
                const node = this.findNodeInTree(session.executionRoot, nodeId);
                if (node) { node.data.error = error; return; }
            }
        }
    }

    // ================================================================
    // 删除
    // ================================================================

    removeMessage(messageId: string): void {
        const index = this.sessions.findIndex(s => s.id === messageId);
        if (index !== -1) this.sessions.splice(index, 1);
    }

    removeMessages(messageIds: string[]): void {
        const idSet = new Set(messageIds);
        this.sessions = this.sessions.filter(s => !idSet.has(s.id));
    }

    // ================================================================
    // 历史 (unified: works against getSessions())
    // ================================================================

    getHistory(): HistoryMessage[] {
        const history: HistoryMessage[] = [];
        for (const session of this.getSessions()) {
            if (session.historyPolicy === 'exclude') continue;
            if (session.role === 'user') {
                history.push({
                    role: 'user',
                    content: session.content || '',
                    files: session.files,
                });
            } else if (session.role === 'assistant' && session.executionRoot) {
                const output = this.extractOutput(session.executionRoot);
                if (output.trim()) {
                    history.push({ role: 'assistant', content: output });
                }
            }
        }
        return history;
    }

    // ================================================================
    // 导出 (unified: works against getSessions())
    // ================================================================

    exportToMarkdown(): string {
        const lines: string[] = [];
        for (const session of this.getSessions()) {
            if (session.role === 'user') {
                lines.push(`## User\n\n${session.content || ''}\n`);
            } else if (session.role === 'assistant' && session.executionRoot) {
                const output = this.extractOutput(session.executionRoot);
                const name = session.executionRoot.name || 'Assistant';
                lines.push(`## ${name}\n\n${output}\n`);
            }
        }
        return lines.join('\n---\n\n');
    }

    // ================================================================
    // 清理
    // ================================================================

    clear(): void {
        this.sessions = [];
        this.turns = [];
        this.turnById.clear();
        this.childrenByParent.clear();
    }

    // ================================================================
    // TurnProjection → SessionGroup adapter
    // ================================================================

    /**
     * Converts one TurnProjection into 1 or 2 SessionGroups.
     * A chat turn with both userMessage and assistantMessage produces:
     *   [SessionGroup(role:'user'), SessionGroup(role:'assistant')]
     * so that both bubbles appear in the UI on reload.
     */
    private turnProjectionToSessionGroups(p: TurnProjection): SessionGroup[] {
        const groups: SessionGroup[] = [];

        if (p.userMessage) {
            groups.push({
                id: `${p.turnId}-user`,
                persistedNodeId: p.userMessage.persistedNodeId,
                role: 'user',
                content: p.userMessage.content,
                files: p.userMessage.files,
                timestamp: p.meta?.createdAt ?? Date.now(),
                origin: (p.meta?.origin as SessionOrigin) ?? 'user',
                historyPolicy: (p.meta?.historyPolicy === 'exclude' ? 'exclude' : 'include') as HistoryPolicy,
            });
        }

        if (p.assistantMessage) {
            groups.push({
                id: p.assistantMessage.persistedNodeId,
                persistedNodeId: p.assistantMessage.persistedNodeId,
                role: 'assistant',
                content: p.assistantMessage.content,
                timestamp: p.meta?.createdAt ?? Date.now(),
                origin: (p.meta?.origin as SessionOrigin) ?? 'user',
                historyPolicy: (p.meta?.historyPolicy === 'exclude' ? 'exclude' : 'include') as HistoryPolicy,
                executionRoot: {
                    id: p.assistantMessage.persistedNodeId,
                    name: 'Assistant',
                    executorType: 'agent',
                    executorId: '',
                    status: p.assistantMessage.status,
                    startTime: p.meta?.createdAt ?? Date.now(),
                    parentId: undefined,
                    data: {
                        output: p.assistantMessage.content,
                        thought: p.assistantMessage.thinking ?? '',
                    },
                    children: [],
                },
            });
        }

        // System / merge turns with no user or assistant message — return empty (not shown in UI)
        return groups;
    }

    private turnProjectionsToSessionGroups(): SessionGroup[] {
        return this.turns.flatMap(t => this.turnProjectionToSessionGroups(t));
    }

    // ================================================================
    // 内部工具
    // ================================================================

    private findNodeInTree(node: ExecutionNode, targetId: string): ExecutionNode | null {
        if (node.id === targetId) return node;
        for (const child of node.children || []) {
            const found = this.findNodeInTree(child, targetId);
            if (found) return found;
        }
        return null;
    }

    private extractOutput(node: ExecutionNode): string {
        let output = node.data?.output || '';
        for (const child of node.children || []) {
            const childOutput = this.extractOutput(child);
            if (childOutput) output += '\n\n' + childOutput;
        }
        return output.trim();
    }
}
