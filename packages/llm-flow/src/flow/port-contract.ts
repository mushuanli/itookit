import { assertFlowSchema, flowSchemaIssue } from './schema-registry';
import { extractNodeOutput } from '@itookit/llm-tasks';
import type { DagEdgeDefinition, DagNodeDefinition, DagPluginCatalog } from '@itookit/common';

/** Schema references are exact contracts; no implicit structural conversion or version coercion. */
export function dataEdgeSchemaIssue(
    edge: Partial<Pick<DagEdgeDefinition, 'kind' | 'output' | 'input'>>,
    source: DagNodeDefinition,
    target: DagNodeDefinition,
    plugins: DagPluginCatalog,
): string | undefined {
    if (edge.kind === 'control') return;
    const output = plugins.getManifest(source.plugin, source.pluginVersion)?.outputs.find(port => port.name === edge.output);
    const input = plugins.getManifest(target.plugin, target.pluginVersion)?.inputs.find(port => port.name === edge.input);
    if (!input?.schema) return;
    const expected = input.schema;
    const actual = output?.schema;
    if (!expected.id?.trim() || (expected.version !== undefined && !expected.version.trim())) return 'Invalid target schema reference';
    if (!actual) return `Output ${source.id}.${edge.output} has no schema required by ${target.id}.${edge.input}`;
    if (actual.id !== expected.id || actual.version !== expected.version) {
        return `Schema mismatch ${actual.id}@${actual.version ?? '(unversioned)'} -> ${expected.id}@${expected.version ?? '(unversioned)'}`;
    }
    const schema = plugins.getSchema?.(expected);
    if (schema === undefined) return `Unregistered schema ${expected.id}@${expected.version ?? '(unversioned)'}`;
    try { assertFlowSchema(schema); } catch (error) { return (error as Error).message; }
}

export function validateDataEdgeValue(
    edge: DagEdgeDefinition, target: DagNodeDefinition, plugins: DagPluginCatalog, output: unknown,
): void {
    if (edge.kind === 'control') return;
    const ref = plugins.getManifest(target.plugin, target.pluginVersion)?.inputs.find(port => port.name === edge.input)?.schema;
    if (!ref) return;
    const schema = plugins.getSchema?.(ref);
    if (schema === undefined) throw new Error(`Unregistered schema ${ref.id}`);
    const issue = flowSchemaIssue(schema, extractNodeOutput(output, edge.output));
    if (issue) throw new Error(`Invalid data on edge ${edge.id}: ${issue}`);
}
