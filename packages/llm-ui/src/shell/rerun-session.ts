import { t, type ChatExecutionMode, type ICommandBus } from '@itookit/common';
import { SessionCommand, type SessionGroup } from '@itookit/llm-session';
import { rerunSessionFlow, type FlowRerunContext } from '../flows/rerun-flow';

/** Start a new run from persisted input; completed effects and files are not rolled back. */
export async function rerunSession(
    commands: ICommandBus, sessionId: string, mode: ChatExecutionMode, signal: AbortSignal,
): Promise<void> {
    const flow = await commands.execute<FlowRerunContext | null>(SessionCommand.FlowRerunContext);
    if (await commands.execute(SessionCommand.GetCurrentId) !== sessionId || signal.aborted) return;
    if (flow) return rerunSessionFlow(commands, signal, flow);
    const sessions = await commands.execute<SessionGroup[]>(SessionCommand.GetSessions);
    const user = [...sessions].reverse().find(message => message.role === 'user');
    if (signal.aborted) return;
    if (!user) throw new Error(t('session.rerun.empty'));
    const check = await commands.execute<{ allowed: boolean; reason?: string }>(SessionCommand.CanRegenerate, { messageId: user.id });
    if (await commands.execute(SessionCommand.GetCurrentId) !== sessionId || signal.aborted) return;
    if (!check.allowed) throw new Error(check.reason || t('session.rerun.unavailable'));
    await commands.execute(SessionCommand.RegenerateFromUser, {
        userMessageId: user.id, options: { overrides: { executionMode: mode } },
    });
}
