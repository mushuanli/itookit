// @file: llm-session/src/persistence/default-flows.ts
// Seed a runnable default workflow (essay auto-review) into the flows module so
// users have a working example out of the box.

import type {
    FlowDraft,
    FlowEdgeDefinition,
    FlowNodeDefinition,
    FlowParameter,
} from '@itookit/common';
import type { FlowDefinitionStore } from '@itookit/llm-flow';

export const ESSAY_REVIEW_FLOW_ID = 'essay-review';

const parameters: FlowParameter[] = [
    { name: 'essay', type: 'json', required: true, description: '作文对象，含 title 和 body' },
    { name: 'requirements', type: 'string', required: true, description: '作文要求：字数、体裁、题目形式、禁写内容等' },
    { name: 'mode', type: 'string', default: 'review', description: 'review / review_and_rewrite' },
    { name: 'pass_score', type: 'number', default: 54, description: '自动改写停止分数（满分 60）' },
    { name: 'max_rounds', type: 'number', default: 2, description: '最多自动改写轮次' },
];

function agentNode(id: string, name: string, instruction: string, extra: Record<string, unknown> = {}): FlowNodeDefinition {
    return {
        id,
        name,
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        config: { instruction, approval: 'external', maxExchanges: 1, ...extra },
        inputs: {},
        capabilities: [],
    };
}

function nodes(): FlowNodeDefinition[] {
    return [
        agentNode('review_content', '内容审查', `你是作文审查员，负责「内容」维度。检查：题目是否合适、主角是否正确、是否跑题、材料是否完整落实、立意是否深刻。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请只输出 JSON：{"dimension":"内容","issues":[{"severity":"致命|主要|次要","desc":"问题描述"}]}`),
        agentNode('review_structure', '结构审查', `你是作文审查员，负责「结构」维度。检查：开篇是否点题、中间是否多次扣题、转折是否合理、详略是否得当、结尾是否回应开头并深化主旨。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请只输出 JSON：{"dimension":"结构","issues":[{"severity":"致命|主要|次要","desc":"问题描述"}]}`),
        agentNode('review_expression', '表达审查', `你是作文审查员，负责「表达」维度。检查：描写是否具体生动、能否引起共情、语言是否符合中学生口吻、有无机器感、有无病句错字。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请只输出 JSON：{"dimension":"表达","issues":[{"severity":"致命|主要|次要","desc":"问题描述"}]}`),
        agentNode('review_norms', '规范审查', `你是作文审查员，负责「规范」维度。检查：字数、段落、题目格式、错别字、病句、真实人名校名地名等硬性要求。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请只输出 JSON：{"dimension":"规范","issues":[{"severity":"致命|主要|次要","desc":"问题描述"}]}`),
        {
            id: 'aggregate',
            name: '汇总去重',
            plugin: 'builtin.reduce',
            pluginVersion: '1.0.0',
            config: { outputName: 'result', type: 'text', separator: '\n\n' },
            inputs: {},
        },
        agentNode('verdict', '一致性裁决', `你是作文审查裁决员。综合四个维度的审查结果，解决矛盾（避免一处建议增加、另一处又要求删除），给出一致性裁决和总分（0-60）。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请只输出 JSON：{"score":<0-60整数>,"fatal":["致命问题"],"major":["主要问题"],"minor":["次要问题"],"summary":"一句话总结"}`, { maxIterations: '${params.max_rounds}', connectionId: 'premium' }),
        {
            id: 'decide',
            name: '是否改写',
            plugin: 'builtin.route',
            pluginVersion: '1.0.0',
            config: {
                mode: 'exclusive',
                rules: [
                    { edgeId: 'decide->report', priority: 1, expression: { kind: 'neq', args: [{ kind: 'param', path: ['mode'] }, { kind: 'literal', value: 'review_and_rewrite' }] } },
                    { edgeId: 'decide->report', priority: 2, expression: { kind: 'gte', args: [{ kind: 'path', path: ['input', 'score'] }, { kind: 'param', path: ['pass_score'] }] } },
                ],
                defaultEdgeId: 'decide->rewrite',
            },
            inputs: {},
        },
        agentNode('rewrite', '生成修改稿', `你是作文修改员。按「先解决跑题、再调整结构、最后润色语言」的顺序修改，并遵守保留/避免清单。
【作文要求】\${params.requirements}
【原作文】\${params.essay}
请只输出 JSON：{"revised_title":"...","revised_body":"..."}`, { maxIterations: '${params.max_rounds}' }),
        agentNode('report', '生成审查报告', `你是作文审查报告生成员。根据最终裁决生成报告，包含：审题结论、材料对应、结构审查、详略描写、语言病句、字数段落、按严重程度排列的问题清单、逐句修改建议。
【作文要求】\${params.requirements}
【作文】\${params.essay}
请输出完整审查报告。`, { connectionId: 'premium' }),
    ] as FlowNodeDefinition[];
}

function edges(): FlowEdgeDefinition[] {
    return [
        { id: 'review_content->aggregate', from: 'review_content', to: 'aggregate', kind: 'data', output: 'result', input: 'input' },
        { id: 'review_structure->aggregate', from: 'review_structure', to: 'aggregate', kind: 'data', output: 'result', input: 'input' },
        { id: 'review_expression->aggregate', from: 'review_expression', to: 'aggregate', kind: 'data', output: 'result', input: 'input' },
        { id: 'review_norms->aggregate', from: 'review_norms', to: 'aggregate', kind: 'data', output: 'result', input: 'input' },
        { id: 'aggregate->verdict', from: 'aggregate', to: 'verdict', kind: 'data', output: 'result', input: 'input' },
        { id: 'verdict->decide', from: 'verdict', to: 'decide', kind: 'data', output: 'result', input: 'input' },
        { id: 'verdict->report', from: 'verdict', to: 'report', kind: 'data', output: 'result', input: 'input' },
        { id: 'decide->report', from: 'decide', to: 'report', kind: 'control' },
        { id: 'decide->rewrite', from: 'decide', to: 'rewrite', kind: 'control' },
        { id: 'rewrite->verdict', from: 'rewrite', to: 'verdict', kind: 'data', output: 'result', input: 'input' },
    ] as FlowEdgeDefinition[];
}

function layout(): FlowDraft['layout'] {
    return {
        nodes: {
            review_content: { x: 40, y: 40 },
            review_structure: { x: 40, y: 240 },
            review_expression: { x: 40, y: 440 },
            review_norms: { x: 40, y: 640 },
            aggregate: { x: 320, y: 340 },
            verdict: { x: 600, y: 200 },
            decide: { x: 880, y: 120 },
            rewrite: { x: 880, y: 340 },
            report: { x: 1160, y: 120 },
        },
        viewport: { x: 0, y: 0, zoom: 0.7 },
    };
}

export function essayReviewDraft(): FlowDraft {
    return {
        id: ESSAY_REVIEW_FLOW_ID as FlowDraft['id'],
        draftVersion: 1,
        name: '作文自动审查',
        nodes: nodes(),
        edges: edges(),
        layout: layout(),
        parameters,
        connections: [
            { name: 'default', connectionId: 'default', description: 'Default model for the four parallel review nodes' },
            { name: 'premium', connectionId: 'default', description: 'Stronger model for verdict & report — bind a higher-quality connection in Flow Settings' },
        ],
        defaultConnection: 'default',
        updatedAt: Date.now(),
    };
}

/** Create the default essay-review workflow if it does not exist yet. */
export async function seedDefaultFlows(store: FlowDefinitionStore): Promise<void> {
    if (await store.loadDraft(ESSAY_REVIEW_FLOW_ID)) return;
    const spec = essayReviewDraft();
    const draft = await store.createDraft({ id: ESSAY_REVIEW_FLOW_ID, name: spec.name });
    const filled: FlowDraft = {
        ...draft,
        nodes: spec.nodes,
        edges: spec.edges,
        layout: spec.layout,
        parameters: spec.parameters,
        connections: spec.connections,
        defaultConnection: spec.defaultConnection,
    };
    await store.saveDraft(filled, draft.draftVersion);
    await store.createRevision(filled);
}
