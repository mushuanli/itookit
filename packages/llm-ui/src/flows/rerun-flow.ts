import { t, type FlowRevision, type ICommandBus, type JsonValue } from '@itookit/common';
import { SessionCommand } from '@itookit/llm-session';
import { promptFlowParameters } from '../components/FlowParameterForm';

export interface FlowRerunContext {
    sessionId: string;
    definitionKey: string;
    sourceRoundId: string | null;
    definition: FlowRevision;
    flow: { parameters?: Record<string, JsonValue> };
}

export async function rerunSessionFlow(commands: ICommandBus, signal: AbortSignal, suppliedContext?: FlowRerunContext): Promise<void> {
    const context = suppliedContext ?? await commands.execute<FlowRerunContext | null>(SessionCommand.FlowRerunContext);
    if (signal.aborted) return;
    if (!context) throw new Error(t('flow.rerun.unavailable'));
    const parameters = (context.definition.parameters ?? []).map(field => ({ ...field,
        default: context.flow.parameters && Object.hasOwn(context.flow.parameters, field.name) ? context.flow.parameters[field.name] : field.default }));
    await promptFlowParameters(parameters, t('flow.rerun.title'), async values => {
        if (signal.aborted) throw new Error(t('flow.rerun.unavailable'));
        await commands.execute(SessionCommand.FlowRerun, { parameters: values, sourceRoundId: context.sourceRoundId, sessionId: context.sessionId, definitionKey: context.definitionKey });
    }, signal);
}
