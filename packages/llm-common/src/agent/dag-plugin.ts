import type {
    ArtifactDraft,
    InputPortSpec,
    JsonValue,
    OutputPortSpec,
    FlowEdgeId,
} from './flow-definition';
import type { DirectRunSpec, ProcessSignal, RunId } from './process';

export interface DagPluginManifest<Config = unknown> {
    id: string;
    version: string;
    kind: string;
    title: string;
    category: string;
    configSchema: JsonValue;
    defaultConfig?: Partial<Config>;
    inputs: InputPortSpec[];
    outputs: OutputPortSpec[];
    requiredCapabilities?: string[];
}

export interface DagNodeDefinition<Config = unknown> {
    id: string;
    name: string;
    plugin: string;
    pluginVersion: string;
    config: Config;
    inputs: Record<string, unknown>;
    priority?: number;
    capabilities?: string[];
    budget?: Record<string, number>;
}

export interface DagEdgeDefinition {
    id: string;
    from: string;
    to: string;
    output: string;
    input: string;
}

export interface DagRunSpec {
    nodes: DagNodeDefinition[];
    edges: DagEdgeDefinition[];
    maxNodes?: number;
}

export interface DagNodeContext<Config = unknown> {
    runId: RunId;
    nodeRunId: string;
    config: Config;
    inputs: Record<string, unknown>;
    signal?: ProcessSignal;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export interface DagRuntimeContribution<Config = unknown> {
    validate?(config: Config): ValidationResult;
    createProcess(context: DagNodeContext<Config>): DirectRunSpec;
    mapOutput?(output: unknown): DagNodeOutcome;
}

export interface DagUIContribution<Config = unknown> {
    palette: {
        label: string;
        group: string;
        icon?: string;
        colorToken?: string;
    };
    node: {
        summarize(config: Config): string;
        renderer?: string;
    };
    inspector: {
        layout?: FormLayout;
        customEditor?: string;
    };
}

export interface DagPluginPresentation {
    manifest: DagPluginManifest;
    ui?: DagUIContribution;
}

export interface FormLayout {
    sections: Array<{
        id: string;
        title?: string;
        fields: string[];
    }>;
}

export interface DagPlugin<Config = unknown> {
    manifest: DagPluginManifest<Config>;
    runtime: () => Promise<DagRuntimeContribution<Config>>;
    ui?: () => Promise<DagUIContribution<Config>>;
}

export interface DagPluginCatalog {
    listManifests(): DagPluginManifest[];
    getManifest(id: string, version?: string): DagPluginManifest | undefined;
    loadRuntime(id: string, version?: string): Promise<DagRuntimeContribution>;
    loadUI(id: string, version?: string): Promise<DagUIContribution | undefined>;
}

export type GraphEffect =
    | { type: 'activate-edge'; edgeId: FlowEdgeId }
    | { type: 'disable-edge'; edgeId: FlowEdgeId }
    | { type: 'patch-graph'; patch: GraphPatch };

export interface GraphPatch {
    idempotencyKey: string;
    nodes: DagNodeDefinition[];
    edges: Array<{
        id: string;
        from: string;
        to: string;
        input?: string;
        output?: string;
    }>;
}

export interface DagNodeOutcome {
    outputs: Record<string, ArtifactDraft>;
    effects?: GraphEffect[];
}
