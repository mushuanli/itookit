import { assertFlowSchema, flowSchemaIssue } from './schema-registry';
import { schemaCompatibilityIssue } from './schema-compat';
import { extractNodeOutput } from '@itookit/llm-tasks';
import type { DagEdgeDefinition, DagNodeDefinition, DagPluginCatalog } from '@itookit/common';

/**
 * Ports declare an exact `id@version` contract. Edges between different versions
 * of the same id are accepted only when the registered schemas prove the source
 * output is a subtype of the target input; different ids stay rejected because
 * they carry different semantics and no implicit conversion is performed.
 */
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
    if (actual.id !== expected.id) {
        return `Schema mismatch ${actual.id}@${actual.version ?? '(unversioned)'} -> ${expected.id}@${expected.version ?? '(unversioned)'}`;
    }
    if (actual.version !== expected.version) {
        const mismatch = `Schema mismatch ${actual.id}@${actual.version ?? '(unversioned)'} -> ${expected.id}@${expected.version ?? '(unversioned)'}`;
        const sourceSchema = plugins.getSchema?.(actual);
        const targetSchema = plugins.getSchema?.(expected);
        if (sourceSchema === undefined || targetSchema === undefined) return mismatch;
        const issue = schemaCompatibilityIssue(sourceSchema, targetSchema);
        if (issue) return `${mismatch}: ${issue}`;
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
