// @file: llm-ui/shell/SlashCommandRouter.ts
// Slash command callbacks — extracted from LLMWorkspaceEditor.
// Builds the SlashCommandCallbacks object used by SlashCommandPlugin.
// Frequently modified: each new slash command or behavior change touches this file.

import { Toast, showConfirmDialog, formatDefaultFileTitle } from '@itookit/common';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IEditorEventBus } from '../domain/events';
import type { SessionManager } from '@itookit/llm-engine';
import type { IAgentConfigService } from '@itookit/common';
import type { IBranchStore } from '../domain/ports/IBranchStore';
import type { BranchService } from '../services/BranchService';
import type { DOMCache } from '../components/common/DOMCache';
import type { Command } from '../commands/Command';
import type { SendMessageCommand } from '../commands/SendMessageCommand';
import type { SwitchBranchByOffsetCommand } from '../commands/BranchCommands';
import type { EditorHostContext } from '@itookit/common';
import type { IChatEngine } from '@itookit/llm-engine';
import type { SlashCommandCallbacks } from '../components/input/plugins/SlashCommandPlugin';
import type { SkillInvocation } from '../domain/types';
import { getHarnessAdapter } from '@itookit/llm-engine';
import { executeSkillInvocation } from './HarnessIntegration';
import { getAgentDisplayName, sanitizeFileName } from './AgentProvider';

export interface SlashCommandRouterDeps {
    sessionManager: SessionManager;
    chatInput: IChatInputPresenter;
    bus: IEditorEventBus;
    historyView: IHistoryPresenter;
    nodeCommands: Map<string, Command<any, any>>;
    branchStore: IBranchStore;
    branchService: BranchService;
    domCache: DOMCache;
    hostContext?: EditorHostContext;
    sendCommand: SendMessageCommand;
    switchBranchByOffsetCommand: SwitchBranchByOffsetCommand;
    agentService: IAgentConfigService;
    _sessionEngine: IChatEngine; // for executeSkillInvocation route
    // Delegates back to Shell for methods that touch Shell state
    handleCopy: () => Promise<void>;
    handlePrint: () => Promise<void>;
    toggleNavigator: () => Promise<void>;
    findCurrentVisibleSession: () => string | null;
    updateCollapseButtonIcon: (isAllCollapsed?: boolean) => void;
}

/**
 * Build the complete SlashCommandCallbacks object.
 * Handles: Common, Refine, Context, View, Tools, Branch, Settings, Help, and Harness commands.
 */
export function buildSlashCallbacks(deps: SlashCommandRouterDeps): SlashCommandCallbacks {
    return {
        // ── Common ──────────────────────────────────────────

        onNew: (args: string) => {
            const agentId = deps.chatInput.getConfig().agentId;
            const title = args.trim() || formatDefaultTitle(agentId, deps.agentService);

            if (!deps.hostContext?.navigate) {
                Toast.info('Navigation not available in this context');
                return;
            }

            sessionStorage.setItem('app_create_params', JSON.stringify({
                target: 'chat',
                state: { agentId: agentId !== 'default' ? agentId : undefined },
                create: { title },
                agentId: agentId !== 'default' ? agentId : undefined,
                title,
                timestamp: Date.now(),
            }));

            deps.hostContext.navigate({
                target: 'chat',
                action: 'create',
                create: { title },
                state: {
                    agentId: agentId !== 'default' ? agentId : undefined,
                },
            });
        },

        onRetry: () => {
            const sessions = deps.sessionManager.getSessions();
            const lastAssistant = [...sessions].reverse()
                .find(s => s.role === 'assistant');
            if (lastAssistant) {
                const cmd = deps.nodeCommands.get('regenerate');
                cmd?.run({ nodeId: lastAssistant.id });
            }
        },

        onContinue: () => {
            sendFollowUp(deps, 'Please continue from where you left off.');
        },

        onReedit: async () => {
            const sessions = deps.sessionManager.getSessions();
            if (sessions.length === 0) {
                Toast.info('No messages to reedit');
                return;
            }

            const lastUser = [...sessions].reverse().find(s => s.role === 'user');
            if (!lastUser) {
                Toast.info('No user message found');
                return;
            }

            const originalText = lastUser.content || '';
            const cmd = deps.nodeCommands.get('delete');
            if (cmd) {
                await cmd.run({ nodeId: lastUser.id });
            }
            deps.chatInput.restoreInput(originalText);
        },

        onDeleteLast: async () => {
            const sessions = deps.sessionManager.getSessions();
            if (sessions.length === 0) {
                Toast.info('No messages to delete');
                return;
            }

            const lastUser = [...sessions].reverse().find(s => s.role === 'user');
            if (!lastUser) {
                Toast.info('No user message found');
                return;
            }

            const confirmed = await showConfirmDialog(
                'Delete last user message and its responses?'
            );
            if (!confirmed) return;

            const cmd = deps.nodeCommands.get('delete');
            cmd?.run({ nodeId: lastUser.id });
        },

        onClear: async () => {
            const sessions = deps.sessionManager.getSessions();
            if (sessions.length === 0) return;

            const confirmed = await showConfirmDialog(
                'Clear all messages in this conversation?'
            );
            if (!confirmed) return;

            const ids = sessions.map(s => s.id);
            deps.bus.emit('batch:delete', { ids });
        },

        onBtw: (args: string) => {
            if (!args.trim()) {
                Toast.error('Usage: /btw <message>');
                return;
            }
            deps.sendCommand.run({
                text: args.trim(),
                files: [],
                origin: 'user',
                historyPolicy: 'exclude',
                overrides: { historyLength: 0 },
            });
        },

        // ── Refine ──────────────────────────────────────────

        onShorter: () => {
            sendFollowUp(deps,
                'Please make your last response more concise and to the point. Keep only the essential information.'
            );
        },

        onLonger: () => {
            sendFollowUp(deps,
                'Please elaborate on your last response with more details, examples, and explanations.'
            );
        },

        onSimplify: () => {
            sendFollowUp(deps,
                'Please explain your last response in simpler terms, as if explaining to someone unfamiliar with the topic.'
            );
        },

        onSummarize: () => {
            sendFollowUp(deps,
                'Please provide a concise summary of our entire conversation so far, highlighting the key points and conclusions.'
            );
        },

        // ── Context ─────────────────────────────────────────

        onHistory: (length: string) => {
            const value = parseInt(length, 10);
            if (isNaN(value)) {
                Toast.error('Usage: /history <number>  (-1 = unlimited, 0 = none)');
                return;
            }
            deps.chatInput.setConfig({
                settings: { historyLength: value },
            });
            deps.bus.emit('state:inputChanged', {});

            const label = value === -1 ? 'unlimited'
                : value === 0 ? 'none'
                : `${value} messages`;
            Toast.info(`History context set to ${label}`);
        },

        onFresh: () => {
            deps.chatInput.setConfig({
                settings: { historyLength: 0 },
            });
            deps.bus.emit('state:inputChanged', {});
            Toast.info('Next message will be sent without history context');
        },

        // ── View ────────────────────────────────────────────

        onFoldCurrent: () => {
            deps.historyView.foldCurrentUnfolded();
        },

        onFoldAll: () => {
            deps.historyView.setAllCollapsed(true);
            deps.bus.emit('state:collapseChanged', {
                states: deps.historyView.getCollapseStates(),
            });
            deps.updateCollapseButtonIcon(true);
        },

        onUnfoldAll: () => {
            deps.historyView.setAllCollapsed(false);
            deps.bus.emit('state:collapseChanged', {
                states: deps.historyView.getCollapseStates(),
            });
            deps.updateCollapseButtonIcon(false);
        },

        onTop: () => {
            const historyEl = deps.domCache.byId('llm-ui-history');
            historyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        },

        onBottom: () => {
            deps.historyView.scrollToBottom(true);
        },

        onNav: () => {
            deps.toggleNavigator();
        },

        // ── Tools ───────────────────────────────────────────

        onExport: async () => {
            await deps.handleCopy();
            Toast.success('Conversation copied as Markdown');
        },

        onCopyAll: () => deps.handleCopy(),
        onPrint: () => deps.handlePrint(),

        // ── Branch ──────────────────────────────────────────

        onCreateBranch: () => {
            const id = deps.findCurrentVisibleSession();
            if (id) deps.bus.emit('branch:create', { sourceNodeId: id });
        },

        onSwitchBranch: (name: string) => {
            const branches = deps.branchStore.current;
            const target = branches.find(
                b => b.name.toLowerCase() === name.toLowerCase()
            );
            if (!target) {
                const available = branches.map(b => b.name).join(', ');
                Toast.error(`Branch "${name}" not found. Available: ${available}`);
                return;
            }
            deps.bus.emit('branch:switch', { branchName: target.name });
        },

        onBranchPrev: () => {
            deps.switchBranchByOffsetCommand.run({
                offset: -1,
                cachedBranches: deps.branchStore.current,
            });
        },

        onBranchNext: () => {
            deps.switchBranchByOffsetCommand.run({
                offset: 1,
                cachedBranches: deps.branchStore.current,
            });
        },

        onListBranches: () => {
            const branches = deps.branchService.list;
            if (branches.length <= 1) {
                Toast.info('Only one branch: main');
                return;
            }
            const list = branches.map((b, i) => {
                const marker = b.isCurrent ? '→ ' : '  ';
                return `${marker}${i + 1}. ${b.name}`;
            }).join('\n');
            Toast.info(`Branches (${branches.length}):\n${list}`);
        },

        onRenameBranch: (args: string) => {
            const parts = args.trim().split(/\s+/);
            if (parts.length < 2) {
                Toast.error('Usage: /renamebranch <old-name> <new-name>');
                return;
            }
            deps.bus.emit('branch:rename', { oldName: parts[0], newName: parts[1] });
        },

        onDeleteBranch: (name: string) => {
            deps.bus.emit('branch:delete', { branchName: name });
        },

        // ── Settings ────────────────────────────────────────

        onSwitchAgent: (agentId: string) => {
            deps.chatInput.setConfig({ agentId });
            deps.bus.emit('state:inputChanged', {});
        },

        onModel: (modelId: string) => {
            deps.chatInput.setConfig({
                settings: { modelId },
            });
            deps.bus.emit('state:inputChanged', {});
            Toast.info(`Model switched to ${modelId}`);
        },

        // ── Help ────────────────────────────────────────────

        onHelp: () => {
            deps.chatInput.showHelp?.();
        },

        // ── Harness: Skills ──────────────────────────────────────────────
        ...buildHarnessSlashCallbacks(deps),
    };
}

// ── Harness slash callbacks ─────────────────────────────────────────────────

function buildHarnessSlashCallbacks(
    deps: SlashCommandRouterDeps,
): Partial<SlashCommandCallbacks> {
    const skillSvc = getHarnessAdapter()?.getSkillService();
    if (!skillSvc) return {};

    const toolSvc = getHarnessAdapter()?.getToolService();
    const runtime = getHarnessAdapter()?.getRuntime();

    return {
        onSkill: async (skillId: string) => {
            const result = await skillSvc.loadSkill(skillId);
            if (result.success) {
                Toast.success(`Skill "${skillId}" loaded (${result.toolIds.length} tools)`);
                const skills = skillSvc.listSkills().map((s) => ({
                    id: s.id, name: s.name, description: s.description,
                    loaded: s.id === skillId, toolCount: s.tools?.length ?? 0, icon: s.icon,
                    enabled: s.enabled,
                }));
                deps.chatInput.refreshSkills(skills);
            } else {
                Toast.error(`Failed to load skill "${skillId}": ${result.error ?? 'unknown error'}`);
            }
        },

        onSkills: () => {
            const skills = skillSvc.listSkills();
            if (skills.length === 0) {
                Toast.info('没有可用的 Skill。请前往 Settings → Skills 添加。');
                return;
            }
            const settingsBtn = document.querySelector('.llm-input__btn--settings') as HTMLButtonElement | null;
            if (settingsBtn) {
                settingsBtn.click();
            } else {
                const names = skills.map((s) => `${s.icon ?? '⚡'} ${s.name}`).join('\n');
                Toast.info(`可用 Skills (${skills.length}):\n${names}\n\n使用 /skill <id> 加载`);
            }
        },

        onTools: () => {
            const skills = skillSvc.listSkills()
                .filter((s) => s.enabled)
                .flatMap((s) => s.tools.map((t) => `${t.toolId} (${s.name})`));
            const toolService = (getHarnessAdapter() as unknown as {
                toolService?: { listTools(): Array<{ id: string }> }
            })?.toolService;
            const builtinTools = toolService?.listTools().map((t) => t.id) ??
                ['file_read', 'file_write', 'shell_exec', 'glob_search', 'grep_search'];
            Toast.info(`Available tools:\n${builtinTools.concat(skills).join('\n  ')}`);
        },

        getSkills: () => {
            const session = runtime?.getCurrentSession();
            const loadedIds = new Set(session?.loadedSkills ?? []);
            return skillSvc.listSkills().map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                loaded: loadedIds.has(s.id),
                enabled: s.enabled,
                toolCount: s.tools?.length ?? 0,
                icon: s.icon,
            }));
        },

        onSkillInvoke: async (invocation: SkillInvocation) => {
            await executeSkillInvocation(invocation, skillSvc, {
                chatInput: deps.chatInput,
                sendCommand: deps.sendCommand,
                sessionEngine: deps._sessionEngine,
            });
        },

        // ── Direct tool invocation (/exec /read /grep /glob) ─────────────
        ...(toolSvc ? {
            onToolInvoke: async (toolId: string, args: Record<string, unknown>, displayCmd: string) => {
                const cwd = deps.chatInput.getConfig()?.settings?.workingDirectory || undefined;
                deps.chatInput.showToolOutput?.(displayCmd, '⏳ Running…', true);
                const result = await toolSvc.invoke({ toolId, args, cwd });
                deps.chatInput.showToolOutput?.(displayCmd, result.output, result.success);
            },
        } : {}),
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendFollowUp(deps: SlashCommandRouterDeps, text: string): void {
    const config = deps.chatInput.getConfig();
    const agentId = config.agentId;
    const overrides = config.settings?.useHarness
        ? { useHarness: true as const, workingDirectory: config.settings.workingDirectory }
        : undefined;
    deps.sendCommand.run({ text, files: [], agentId, overrides });
}

function formatDefaultTitle(agentId: string, agentService: IAgentConfigService): string {
    const base = formatDefaultFileTitle();
    const agentName = sanitizeFileName(getAgentDisplayName(agentId, agentService));
    return `${base}_${agentName}`;
}
