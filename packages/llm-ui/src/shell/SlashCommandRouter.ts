import { parseDirectoryCommand } from './directory-command';
// @file: llm-ui/shell/SlashCommandRouter.ts
// Slash command callbacks — extracted from LLMWorkspaceEditor.
// Builds the SlashCommandCallbacks object used by SlashCommandPlugin.
// Frequently modified: each new slash command or behavior change touches this file.


import { SessionCommand, type SessionGroup, type ISessionRepository } from '@itookit/llm-session';
import { formatDefaultFileTitle, t } from '@itookit/common';
import { showConfirmDialog } from '@itookit/ui-common';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter'
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter'
import type { IEditorEventBus } from '../domain/events'
import type { ICommandBus
} from '@itookit/common';
import { Toast } from '@itookit/ui-common';

import type { IAgentConfigService } from '@itookit/common';
import type { IBranchStore } from '../domain/ports/IBranchStore';
import type { BranchService } from '../services/BranchService';
import type { DOMCache } from '../components/common/DOMCache';
import type { Command } from '../commands/Command';
import type { SendMessageCommand } from '../commands/SendMessageCommand';
import type { SwitchBranchByOffsetCommand } from '../commands/BranchCommands';
import type { EditorHostContext } from '@itookit/ui-common';

import type { SlashCommandCallbacks } from '../components/input/plugins/SlashCommandPlugin';
import { buildActionSkillMessage, buildSkillPrompt } from '../components/input/SkillInvocationParser';
import type { SkillInfo, SkillInvocation } from '../domain/types';
import { getAgentDisplayName, sanitizeFileName } from './AgentProvider';

export interface PrivilegedSlashCommands {
    plan(goal: string): Promise<void>;
    exec(command: string): Promise<void>;
    cancel(): Promise<void>;
    resume(): Promise<void>;
    approve(note: string): Promise<void>;
}

/**
 * Session Skill access for the slash popup. `snapshot` must be synchronous because the popup
 * builds `/sk-<id>` commands while rendering; the shell keeps it fresh through the same
 * subscription that refreshes the input-side Skill panel.
 */
export interface SlashSkillCommands {
    snapshot(): SkillInfo[];
    load(skillId: string): Promise<unknown>;
    /** Definition lookup for `/sk-<id>`; undefined when the Skill no longer exists. */
    describe(skillId: string): Promise<SlashSkillDefinition | undefined>;
    openPanel(): void;
    /** Ask the shell to re-read the Session Skill list for the next synchronous snapshot. */
    refresh(): void;
}

export interface SlashSkillDefinition {
    name: string;
    type: string;
    instructions: string;
    triggerStrategy?: 'reference' | 'action';
    disableModelInvocation?: boolean;
    enabled: boolean;
}

function isDirectInvocation(skill: SlashSkillDefinition): boolean {
    return skill.triggerStrategy === 'action' || Boolean(skill.disableModelInvocation);
}

export interface SlashCommandRouterDeps {
    onFlow?: (args: string) => Promise<boolean>;
    commands: ICommandBus;
    chatInput: IChatInputPresenter;
    bus: IEditorEventBus;
    historyView: IHistoryPresenter;
    nodeCommands: Map<string, Command<any, any>>;
    branchStore: IBranchStore;
    branchService: BranchService;
    domCache: DOMCache;
    hostContext?: EditorHostContext;
    /**
     * Resolve the send command lazily: the slash callbacks are built while the input plugins
     * register, which happens before `initCommands()` creates `SendMessageCommand`. Capturing
     * the instance here used to pass `undefined` and made every sending slash command (`/btw`,
     * `/sk-<id>`) fail silently.
     */
    sendCommand: () => SendMessageCommand;
    switchBranchByOffsetCommand: SwitchBranchByOffsetCommand;
    agentService: IAgentConfigService;
    _sessionEngine: ISessionRepository; // for executeSkillInvocation route
    // Delegates back to Shell for methods that touch Shell state
    handleCopy: () => Promise<void>;
    handlePrint: () => Promise<void>;
    toggleNavigator: () => Promise<void>;
    findCurrentVisibleSession: () => string | null;
    updateCollapseButtonIcon: (isAllCollapsed?: boolean) => void;
    privilegedCommands?: PrivilegedSlashCommands;
    /** Absent until the host injects Session Skill controls; without it no Skill slash command appears. */
    skills?: SlashSkillCommands;
}

/**
 * Build the complete SlashCommandCallbacks object.
 * Handles: Common, Refine, Context, View, Tools, Branch, Settings, Help, and Kernel commands.
 */
export function buildSlashCallbacks(deps: SlashCommandRouterDeps): SlashCommandCallbacks {
    return {
        onFlow: deps.onFlow,
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
            deps.commands.execute<SessionGroup[]>(SessionCommand.GetSessions).then(sessions => {
                const lastAssistant = [...sessions].reverse()
                    .find(s => s.role === 'assistant');
                if (lastAssistant) {
                    const cmd = deps.nodeCommands.get('regenerate');
                    cmd?.run({ nodeId: lastAssistant.id });
                }
            }).catch(() => {});
        },

        onContinue: () => {
            sendFollowUp(deps, 'Please continue from where you left off.');
        },

        onReedit: async () => {
            const sessions = await deps.commands.execute<SessionGroup[]>(SessionCommand.GetSessions);
            const lastUser = [...sessions].reverse().find(s => s.role === 'user');
            if (!lastUser) {
                Toast.info('No messages to reedit');
                return;
            }
            const originalText = lastUser.content || '';
            await deps.commands.execute(SessionCommand.DeleteMessage, {
                messageId: lastUser.id,
                options: { deleteAssociatedResponses: true },
            });
            deps.chatInput.restoreInput(originalText);
        },

        onDeleteLast: async () => {
            const sessions = await deps.commands.execute<SessionGroup[]>(SessionCommand.GetSessions);
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
            const sessions = await deps.commands.execute<SessionGroup[]>(SessionCommand.GetSessions);
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
            deps.sendCommand().run({
                text: args.trim(),
                files: [],
                origin: 'user',
                historyPolicy: 'exclude',
                overrides: { historyLength: 0 },
            });
        },

        onAddDirectory: deps.hostContext?.directoryCommands ? async raw => {
            const { directory, access } = parseDirectoryCommand(raw);
            Toast.success(await deps.hostContext!.directoryCommands!.addDirectory(directory, access));
        } : undefined,
        onSetHome: deps.hostContext?.directoryCommands ? async raw => {
            const { directory } = parseDirectoryCommand(raw, false);
            Toast.success(await deps.hostContext!.directoryCommands!.setHome(directory));
        } : undefined,
        onPlan: deps.privilegedCommands?.plan,
        onCancelTask: deps.privilegedCommands?.cancel,
        onResumeTask: deps.privilegedCommands?.resume,
        onApproveTask: deps.privilegedCommands?.approve,
        onExec: deps.privilegedCommands?.exec,

        // ── Kernel Skills ───────────────────────────────────
        // `/skill <id>` loads, `/sk-<id>` loads and sends an invocation prompt. Action skills
        // have no other UI entry point: the Skill panel disables their unloaded checkbox.
        ...(deps.skills ? {
            getSkills: () => deps.skills!.snapshot(),
            onSkillPickerOpen: () => deps.skills!.refresh(),
            onSkill: async (skillId: string) => { await deps.skills!.load(skillId); },
            onSkills: () => deps.skills!.openPanel(),
            onSkillInvoke: async (invocation: SkillInvocation) => {
                const skill = await deps.skills!.describe(invocation.skillId);
                if (!skill?.enabled) throw new Error(t('slash.error.skillUnavailable'));
                // Action/silent Skills are refused by the model-context gate, so their body is
                // inlined into the user message instead of being loaded into the Skill context.
                if (skill && isDirectInvocation(skill)) {
                    deps.sendCommand().run({
                        text: buildActionSkillMessage(invocation, skill.instructions),
                        files: [],
                        origin: 'user',
                    });
                    return;
                }
                await deps.skills!.load(invocation.skillId);
                // Every filesystem Skill is currently type `prompt` (see skill-design), which is
                // what makes the free text an explicit task directive instead of a bare sentence.
                deps.sendCommand().run({
                    text: buildSkillPrompt(invocation, skill?.name ?? invocation.skillId, skill?.type ?? 'prompt'),
                    files: [],
                    origin: 'user',
                });
            },
        } : {}),

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
            // /agent takes a raw id, so a typo or a display name silently poisons the
            // next send (resolveForChat falls back to a config without agentVersion).
            if (!deps.agentService.findAgent(agentId)) {
                const known = deps.agentService.listAgents().map(agent => agent.id);
                console.warn(
                    `[SlashCommand] /agent '${agentId}' is not a known agent id — sends will fail until a valid id is selected. `
                    + `Known ids: ${known.length ? known.join(', ') : '(none loaded)'}`,
                );
            }
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
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendFollowUp(deps: SlashCommandRouterDeps, text: string): void {
    const config = deps.chatInput.getConfig();
    const agentId = config.agentId;
    deps.sendCommand().run({ text, files: [], agentId });
}

function formatDefaultTitle(agentId: string, agentService: IAgentConfigService): string {
    const base = formatDefaultFileTitle();
    const agentName = sanitizeFileName(getAgentDisplayName(agentId, agentService));
    return `${base}_${agentName}`;
}
