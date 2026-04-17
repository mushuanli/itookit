// @file: llm-harness/src/executor/context-manager.ts
// 四层渐进式上下文压缩管理器实现。

import type {
    IContextManager,
    ILLMService,
    ISkillService,
    CompressionInfo,
    SkillDefinition,
} from '@itookit/common';
import type { ChatMessage } from '@itookit/common';

/** 每条消息的粗略 token 估算倍率（字符数 / 4） */
const CHARS_PER_TOKEN = 4;

/** 截断工具输出时保留的头尾行数 */
const SNIP_HEAD_LINES = 30;
const SNIP_TAIL_LINES = 10;

/** L4 滑动窗口保留的最近消息数 */
const SLIDING_WINDOW_SIZE = 6;

/** 触发各层压缩的 urgency 阈值 */
const THRESHOLD_L1 = 0.70;
const THRESHOLD_L2 = 0.80;
const THRESHOLD_L3 = 0.85;
const THRESHOLD_L4 = 0.95;

interface EnvironmentSnapshot {
    os: string;
    cwd: string;
    time: () => string; // resolved lazily so each call gets current time
    nodeVersion: string;
}

interface SessionCtx {
    messages: ChatMessage[];
    compressionSummary: string | null;
    loadedSkillIds: string[];
    env: EnvironmentSnapshot;
    memoryContent: string;
}

export class ContextManager implements IContextManager {
    private sessions = new Map<string, SessionCtx>();

    constructor(
        private readonly llm: ILLMService,
        private readonly skillService: ISkillService,
        private readonly maxContextTokens: number,
        private readonly systemPromptBudgetTokens: number,
        private readonly summarizerConnectionId?: string,
    ) {}

    // ── 会话生命周期 ──

    initSession(sessionId: string, cwd: string, memoryContent: string): void {
        this.sessions.set(sessionId, {
            messages: [],
            compressionSummary: null,
            loadedSkillIds: [],
            env: {
                os: typeof process !== 'undefined' ? process.platform : 'browser',
                cwd,
                time: () => new Date().toISOString(),
                nodeVersion: typeof process !== 'undefined' ? process.version : 'N/A',
            },
            memoryContent,
        });
    }

    addMessage(sessionId: string, message: ChatMessage): void {
        this.getSession(sessionId).messages.push(message);
    }

    markSkillLoaded(sessionId: string, skillId: string): void {
        const s = this.getSession(sessionId);
        if (!s.loadedSkillIds.includes(skillId)) s.loadedSkillIds.push(skillId);
    }

    /** Returns skill IDs loaded in this session (for AgentSessionInfo). */
    getLoadedSkillIds(sessionId: string): string[] {
        return [...this.getSession(sessionId).loadedSkillIds];
    }

    /** Whether this session has ever been compressed (for AgentSessionInfo). */
    isSessionCompressed(sessionId: string): boolean {
        return this.getSession(sessionId).compressionSummary !== null;
    }

    /**
     * Auto-load skills at session init.
     * Loads skills flagged with autoLoad=true unconditionally, then loads any skills
     * whose triggerPatterns match the given prompt.
     * Called once at session init so the first LLM turn already has relevant skills.
     */
    autoDetectAndLoadSkills(sessionId: string, prompt: string): void {
        // Always load skills flagged for auto-load regardless of prompt content.
        for (const skill of this.skillService.listSkills()) {
            if (skill.autoLoad && skill.enabled) {
                this.markSkillLoaded(sessionId, skill.id);
            }
        }
        // Additionally load skills whose triggerPatterns match the current prompt.
        const matched = this.skillService.autoDetectSkills?.(prompt) ?? [];
        for (const skillId of matched) {
            this.markSkillLoaded(sessionId, skillId);
        }
    }

    // ── IContextManager ──

    buildSystemPrompt(sessionId: string): string {
        const s = this.getSession(sessionId);
        const budget = this.systemPromptBudgetTokens;
        const sections: Array<{ priority: number; content: string }> = [];

        // Agent-provided system prompt takes top priority and replaces the default identity.
        if (s.memoryContent) {
            sections.push({ priority: 0, content: s.memoryContent });
        } else {
            sections.push({ priority: 0, content: this.buildCoreIdentity() });
        }

        sections.push({
            priority: 1,
            content: this.buildEnvironment(s.env),
        });

        // Use session-local loadedSkillIds as source of truth to avoid cross-session pollution.
        // skillService.getLoadedSkills() returns global state — unreliable with concurrent sessions.
        // Guard with sk.enabled: if a skill was loaded then later disabled, exclude it from injection.
        const allSkills = this.skillService.listSkills();
        const sessionLoadedSkills = allSkills.filter(
            (sk) => s.loadedSkillIds.includes(sk.id) && sk.enabled,
        );
        if (sessionLoadedSkills.length > 0) {
            const text = sessionLoadedSkills.map((sk: SkillDefinition) => sk.instructions).join('\n\n');
            if (text) sections.push({ priority: 2, content: text });
        }

        // P3: prompt-type skills inject their instructions directly — no load_skill call needed.
        // Unlike http/shell/mcp skills, prompt skills have no tools to register, so they can be
        // injected unconditionally. Budget gating still applies (priority 3, drops if too large).
        const promptSkills = allSkills.filter(
            (sk) => !s.loadedSkillIds.includes(sk.id) && sk.enabled && sk.type === 'prompt',
        );
        if (promptSkills.length > 0) {
            const text = promptSkills.map((sk: SkillDefinition) => sk.instructions).join('\n\n');
            if (text) sections.push({ priority: 3, content: text });
        }

        // P4: tool-type skills (http/shell/mcp/builtin) use progressive disclosure.
        // The LLM must call load_skill to activate them, which triggers tool registration.
        const unloaded = allSkills.filter(
            (sk) => !s.loadedSkillIds.includes(sk.id) && sk.enabled && sk.type !== 'prompt',
        );
        if (unloaded.length > 0) {
            const list = unloaded
                .map((sk: SkillDefinition) => `- **${sk.id}**: ${sk.description}`)
                .join('\n');
            sections.push({
                priority: 4,
                content: `## Available Skills (not loaded)\nUse the load_skill tool to activate:\n${list}`,
            });
        }

        sections.sort((a, b) => a.priority - b.priority);

        let used = 0;
        const parts: string[] = [];
        for (const sec of sections) {
            const tokens = Math.ceil(sec.content.length / CHARS_PER_TOKEN);
            if (sec.priority === 0 || used + tokens <= budget) {
                parts.push(sec.content);
                used += tokens;
            }
        }

        return parts.join('\n\n');
    }

    buildMessages(sessionId: string): ChatMessage[] {
        const s = this.getSession(sessionId);
        if (!s.compressionSummary) return [...s.messages];

        const summaryMsg: ChatMessage = {
            role: 'user',
            content: [{ type: 'text', text: `[Context Summary]\n${s.compressionSummary}` }],
        };
        return [summaryMsg, ...s.messages];
    }

    async maybeCompress(sessionId: string, urgency: number): Promise<CompressionInfo | null> {
        if (urgency < THRESHOLD_L1) return null;

        if (urgency >= THRESHOLD_L1 && urgency < THRESHOLD_L2) {
            return this.applyL1HistorySnip(sessionId);
        }
        if (urgency >= THRESHOLD_L2 && urgency < THRESHOLD_L3) {
            return this.applyL2CachePrune(sessionId);
        }
        if (urgency >= THRESHOLD_L3 && urgency < THRESHOLD_L4) {
            return await this.applyL3LLMSummarize(sessionId);
        }
        return this.applyL4SlidingWindow(sessionId);
    }

    async forceCompress(sessionId: string): Promise<CompressionInfo> {
        return await this.applyL3LLMSummarize(sessionId);
    }

    estimateContextTokens(sessionId: string): number {
        const s = this.getSession(sessionId);
        const msgText = s.messages.map((m) => this.messageToText(m)).join('');
        return Math.ceil(msgText.length / CHARS_PER_TOKEN);
    }

    getContextUsageRatio(sessionId: string): number {
        const used = this.estimateContextTokens(sessionId);
        return Math.min(1, used / this.maxContextTokens);
    }

    // ── Compression layers ──

    private applyL1HistorySnip(sessionId: string): CompressionInfo {
        const s = this.getSession(sessionId);
        const before = this.estimateContextTokens(sessionId);

        s.messages = s.messages.map((msg) => {
            const text = this.messageToText(msg);
            if (text.length <= 2000) return msg;

            const lines = text.split('\n');
            if (lines.length <= SNIP_HEAD_LINES + SNIP_TAIL_LINES) return msg;

            const head = lines.slice(0, SNIP_HEAD_LINES);
            const tail = lines.slice(-SNIP_TAIL_LINES);
            const snipped = lines.length - SNIP_HEAD_LINES - SNIP_TAIL_LINES;
            const snippedContent = [
                ...head,
                `[... ${snipped} lines snipped ...]`,
                ...tail,
            ].join('\n');

            return { ...msg, content: [{ type: 'text' as const, text: snippedContent }] };
        });

        const after = this.estimateContextTokens(sessionId);
        return { layer: 1, layerName: 'history_snip', beforeTokens: before, afterTokens: after };
    }

    private applyL2CachePrune(sessionId: string): CompressionInfo {
        const s = this.getSession(sessionId);
        const before = this.estimateContextTokens(sessionId);

        const SAFE_ZONE = 10;
        const prunable = s.messages.slice(0, -SAFE_ZONE);
        const safe = s.messages.slice(-SAFE_ZONE);

        const kept = prunable.filter((msg) => {
            if (msg.role !== 'assistant') return true;
            const text = this.messageToText(msg);
            const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
            const isSubstantial = text.length > 400;
            return hasToolCalls || isSubstantial;
        });

        s.messages = [...kept, ...safe];
        const after = this.estimateContextTokens(sessionId);
        return { layer: 2, layerName: 'cache_prune', beforeTokens: before, afterTokens: after };
    }

    private async applyL3LLMSummarize(sessionId: string): Promise<CompressionInfo> {
        const s = this.getSession(sessionId);
        const before = this.estimateContextTokens(sessionId);

        const splitIdx = Math.floor(s.messages.length * 0.6);
        const toSummarize = s.messages.slice(0, splitIdx);
        const toKeep = s.messages.slice(splitIdx);

        if (toSummarize.length === 0) {
            return this.applyL4SlidingWindow(sessionId);
        }

        const connId = this.summarizerConnectionId;
        let summary: string;

        if (connId) {
            try {
                const convText = toSummarize.map((m) => `[${m.role}]: ${this.messageToText(m)}`).join('\n');
                const response = await this.llm.chat(connId, {
                    messages: [
                        {
                            role: 'system',
                            content: 'Summarize this conversation. Preserve: file paths, decisions, unresolved errors, user constraints. Be concise.',
                        },
                        { role: 'user', content: convText },
                    ],
                    maxTokens: 1024,
                });
                summary = response.choices[0]?.message.content ?? '';
            } catch {
                summary = this.regexExtractSummary(toSummarize);
            }
        } else {
            summary = this.regexExtractSummary(toSummarize);
        }

        s.compressionSummary = summary;
        s.messages = toKeep;

        const after = this.estimateContextTokens(sessionId);
        return { layer: 3, layerName: 'llm_summarize', beforeTokens: before, afterTokens: after };
    }

    private applyL4SlidingWindow(sessionId: string): CompressionInfo {
        const s = this.getSession(sessionId);
        const before = this.estimateContextTokens(sessionId);

        s.messages = s.messages.slice(-SLIDING_WINDOW_SIZE);
        s.compressionSummary = (s.compressionSummary ?? '') +
            '\n[Note: Context was aggressively truncated due to size limits.]';

        const after = this.estimateContextTokens(sessionId);
        return { layer: 4, layerName: 'sliding_window', beforeTokens: before, afterTokens: after };
    }

    // ── Helpers ──

    private buildCoreIdentity(): string {
        return (
            'You are an AI assistant with access to local tools. ' +
            'Use tools to accomplish tasks. Think step by step. ' +
            'When done, provide a clear summary of what was accomplished.'
        );
    }

    private buildEnvironment(env: EnvironmentSnapshot): string {
        return [
            `OS: ${env.os}`,
            `CWD: ${env.cwd}`,
            `Time: ${env.time()}`,
            `Node: ${env.nodeVersion}`,
        ].join('\n');
    }

    private messageToText(msg: ChatMessage): string {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
            return msg.content
                .map((part: unknown) => {
                    if (typeof part === 'string') return part;
                    const p = part as Record<string, unknown>;
                    if (p['type'] === 'text' && typeof p['text'] === 'string') return p['text'];
                    return '';
                })
                .join('');
        }
        return '';
    }

    private regexExtractSummary(messages: ChatMessage[]): string {
        const fileRefs: string[] = [];
        const errors: string[] = [];

        for (const msg of messages) {
            const text = this.messageToText(msg);
            const filePaths = text.match(/[\w/.-]+\.[a-zA-Z]{1,5}(?::\d+)?/g) ?? [];
            fileRefs.push(...filePaths.filter((p) => p.includes('/')));
            const errLines = text.match(/error:.+/gi) ?? [];
            errors.push(...errLines.slice(0, 3));
        }

        const parts: string[] = ['[Auto-generated summary]'];
        if (fileRefs.length) parts.push(`Files referenced: ${[...new Set(fileRefs)].slice(0, 20).join(', ')}`);
        if (errors.length) parts.push(`Errors seen: ${[...new Set(errors)].join('; ')}`);
        return parts.join('\n');
    }

    private getSession(sessionId: string): SessionCtx {
        const s = this.sessions.get(sessionId);
        if (!s) throw new Error(`No session: ${sessionId}`);
        return s;
    }
}
