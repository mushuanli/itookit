// @file: llm-ui/shell/HarnessIntegration.ts
// Harness-related logic extracted from LLMWorkspaceEditor.
// Handles: harness callbacks, skill invocation, interrupted sessions, plan confirm, injection.

import type { IAgentRuntime } from '@itookit/common';
import type { ISkillService } from '@itookit/common';
import { Toast, Modal } from '@itookit/common';
import type { HarnessAdapter } from '@itookit/llm-engine';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { SendMessageCommand } from '../commands/SendMessageCommand';
import type { SkillInvocation } from '../domain/types';
import {
    buildSkillPrompt, getShellTemplateParams, getMissingParams, buildWizardRefill,
} from '../components/input/SkillInvocationParser';
import type { IChatEngine } from '@itookit/llm-engine';

export interface HarnessIntegrationDeps {
    chatInput: IChatInputPresenter;
    sendCommand: SendMessageCommand;
    sessionEngine: IChatEngine;
}

/**
 * Build harness callbacks for ChatInput construction.
 * Only wired when HarnessAdapter with SkillService is available.
 */
export function buildHarnessCallbacks(
    adapter: HarnessAdapter | null,
    runtime: IAgentRuntime | undefined,
): Partial<Record<string, any>> {
    const skillSvc = adapter?.getSkillService();
    if (!skillSvc || !runtime) return {};

    return {
        onRequestSkills: async () => {
            const session = runtime.getCurrentSession();
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

        onLoadSkill: async (skillId: string) => {
            const result = await skillSvc.loadSkill(skillId);
            return result.toolIds;
        },

        onUnloadSkill: async (skillId: string) => {
            await skillSvc.unloadSkill(skillId);
        },
    };
}

// ── Interrupted session recovery ───────────────────────────────────────────

/**
 * 检查当前会话是否在上次执行中被中断。
 *
 * 从 VFS .chat 文件的 meta.status 检测：如果最后一个 assistant
 * 的 executionRoot.status === 'running'，说明上次执行未正常结束。
 *
 * 仅在加载到该 session 时调用，替代旧的全局 localStorage 扫描。
 *
 * @param snapshot - bindSession 返回的快照
 * @param onResume - 用户点击"重新执行"时的回调，传入被中断的 assistant ID
 */
export function checkSessionInterrupted(
    snapshot: { interruptedAssistantId?: string },
    onResume: (interruptedAssistantId: string) => void,
): void {
    if (!snapshot.interruptedAssistantId) return;
    Toast.action(
        '上次 Agent 任务未完成，是否需要重新执行？',
        '重新执行',
        () => onResume(snapshot.interruptedAssistantId!),
    );
}

// ── Mid-execution injection ────────────────────────────────────────────────

export function injectIntoRunningHarness(
    getHarnessAdapterFn: () => HarnessAdapter | null,
    message: string,
): boolean {
    const runtime = getHarnessAdapterFn()?.getRuntime();
    const session = runtime?.getCurrentSession();
    if (!session || session.status !== 'running') return false;
    runtime!.inject(message);
    Toast.info('已注入指令 — Agent 将在下一轮感知到');
    return true;
}

// ── Plan confirm intercept ─────────────────────────────────────────────────

export function wirePlanConfirmIntercept(
    runtime: IAgentRuntime,
): () => void {
    return runtime.onIntercept('agent:plan:confirm', (payload) => {
        const toolList = payload.plannedTools
            .map((t: any) => `• ${t.name}(${JSON.stringify(t.args).slice(0, 60)})`)
            .join('\n');
        return new Promise<boolean | string>((resolve) => {
            Modal.confirm(
                'Plan 确认',
                `Agent 计划执行以下操作:\n${toolList}\n\n点击"确认"批准执行，或关闭取消任务。`,
                () => resolve(true),
            );
            setTimeout(() => resolve(false), 120_000);
        });
    });
}

// ── Skill invocation execution ─────────────────────────────────────────────

export async function executeSkillInvocation(
    invocation: SkillInvocation,
    skillSvc: ISkillService,
    deps: HarnessIntegrationDeps,
): Promise<void> {
    const skill = skillSvc.getSkill(invocation.skillId);

    // 1. Load the skill if not already loaded
    if (skill) {
        const result = await skillSvc.loadSkill(invocation.skillId);
        if (!result.success) {
            Toast.error(`Failed to load skill "${invocation.skillId}": ${result.error}`);
            return;
        }
    } else {
        Toast.error(`Skill "${invocation.skillId}" not found. Use /skills to browse available skills.`);
        return;
    }

    // 2. Check for missing required params
    if (skill.type === 'shell') {
        const shellCmd = skill.tools.find((t: any) => t.executionType === 'shell' && t.command)?.command;
        if (shellCmd) {
            const required = getShellTemplateParams(shellCmd);
            const missing = getMissingParams(required, invocation.args);
            if (missing.length > 0) {
                const refill = buildWizardRefill(invocation, missing);
                deps.chatInput.restoreInput(refill);
                deps.chatInput.focus();
                Toast.error(
                    `Missing: ${missing.map(m => `--${m}`).join(', ')} — fill blanks (___) and press Enter.`,
                );
                return;
            }
        }
    }

    // 3. Expand glob patterns → resolve to concrete file paths
    let resolvedFilePaths = [...invocation.filePaths];
    if (invocation.globPatterns.length > 0) {
        const engine = deps.sessionEngine;
        for (const pattern of invocation.globPatterns) {
            try {
                const results = await engine.search({ text: pattern, type: 'file', limit: 50 });
                const paths = results
                    .filter((n) => n.type === 'file')
                    .map((n) => n.path.startsWith('/') ? `.${n.path}` : `./${n.path}`);
                resolvedFilePaths = [...resolvedFilePaths, ...paths];
            } catch { /* ignore, best-effort */ }
        }
    }

    // 4. Build the prompt for the agent
    const fullInvocation = { ...invocation, filePaths: resolvedFilePaths };
    const prompt = buildSkillPrompt(fullInvocation, skill.name, skill.type);

    // 5. Send (always via harness for skill invocations)
    const agentId = deps.chatInput.getConfig().agentId;
    const overrides = {
        useHarness: true,
        workingDirectory: deps.chatInput.getConfig().settings.workingDirectory || undefined,
    };

    await deps.sendCommand.run({ text: prompt, files: [], agentId, overrides });
}
