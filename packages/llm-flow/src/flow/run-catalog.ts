import type { DagNodeDefinition, DagPluginCatalog, DagPluginManifest, JsonSchemaRef, JsonValue } from '@itookit/common';

/** Pin metadata on first use; executable contributions remain owned by the host catalog. */
export function createRunCatalog(source: DagPluginCatalog, nodes: DagNodeDefinition[]): DagPluginCatalog {
    const manifests = new Map<string, DagPluginManifest | undefined>();
    const schemas = new Map<string, JsonValue | undefined>();
    const getSchema = (ref: JsonSchemaRef): JsonValue | undefined => {
        const key = JSON.stringify([ref.id, ref.version ?? null]);
        if (!schemas.has(key)) schemas.set(key, structuredClone(source.getSchema?.(ref)));
        return structuredClone(schemas.get(key));
    };
    const getManifest = (id: string, version?: string): DagPluginManifest | undefined => {
        const key = JSON.stringify([id, version ?? null]);
        if (!manifests.has(key)) {
            const manifest = structuredClone(source.getManifest(id, version));
            manifests.set(key, manifest);
            for (const port of [...(manifest?.inputs ?? []), ...(manifest?.outputs ?? [])]) {
                if (port.schema) getSchema(port.schema);
            }
        }
        return structuredClone(manifests.get(key));
    };
    for (const node of nodes) getManifest(node.plugin, node.pluginVersion);
    return {
        getManifest, getSchema,
        listManifests: () => [...manifests.values()].filter((item): item is DagPluginManifest => !!item).map(item => structuredClone(item)),
        loadRuntime: (id, version) => source.loadRuntime(id, version),
        loadUI: (id, version) => source.loadUI(id, version),
    };
}
