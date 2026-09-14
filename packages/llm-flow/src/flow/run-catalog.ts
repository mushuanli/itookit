import type { DagNodeDefinition, DagPluginCatalog, DagPluginManifest, JsonSchemaRef, JsonValue } from '@itookit/common';

export interface RunCatalogSnapshot {
    manifests: [string, DagPluginManifest | null][];
    schemas: [string, JsonValue | null][];
}

/** Pin metadata durably; executable contributions remain owned by the host catalog. */
export function createRunCatalog(source: DagPluginCatalog, nodes: DagNodeDefinition[], saved?: RunCatalogSnapshot):
    DagPluginCatalog & { snapshot(): RunCatalogSnapshot } {
    const manifests = new Map<string, DagPluginManifest | undefined>(saved?.manifests.map(([key, value]) => [key, value ?? undefined]));
    const schemas = new Map<string, JsonValue | undefined>(saved?.schemas.map(([key, value]) => [key, value ?? undefined]));
    if (saved) assertCatalogUnchanged(source, saved);
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
        snapshot: () => structuredClone({
            manifests: [...manifests].map(([key, value]) => [key, value ?? null]),
            schemas: [...schemas].map(([key, value]) => [key, value ?? null]),
        }),
        listManifests: () => [...manifests.values()].filter((item): item is DagPluginManifest => !!item).map(item => structuredClone(item)),
        loadRuntime: (id, version) => source.loadRuntime(id, version),
        loadUI: (id, version) => source.loadUI(id, version),
    };
}

function assertCatalogUnchanged(source: DagPluginCatalog, saved: RunCatalogSnapshot): void {
    for (const [key, expected] of saved.manifests) {
        const [id, version] = JSON.parse(key) as [string, string | null];
        if (canonical(source.getManifest(id, version ?? undefined) ?? null) !== canonical(expected)) {
            throw new Error(`Flow plugin contract drift: ${id}@${version ?? 'latest'}`);
        }
    }
    for (const [key, expected] of saved.schemas) {
        const [id, version] = JSON.parse(key) as [string, string | null];
        if (canonical(source.getSchema?.({ id, ...(version === null ? {} : { version }) }) ?? null) !== canonical(expected)) {
            throw new Error(`Flow schema drift: ${id}@${version ?? '(unversioned)'}`);
        }
    }
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    return JSON.stringify(value);
}
