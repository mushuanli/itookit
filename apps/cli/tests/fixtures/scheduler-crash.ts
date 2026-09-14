import { Kernel } from '@itookit/durable-kernel';
import { DurableFlowExecutor } from '@itookit/llm-flow';

// Inject only at public host boundaries; the killed process never rewrites durable state.
const submit = Kernel.prototype.submit;
Kernel.prototype.submit = async function<I, O>(sessionId: string, spec: import('@itookit/durable-kernel').TaskSpec<I>) {
    const handle = await submit.call(this, sessionId, spec);
    const target = process.env.MINDOS_TEST_SUBMIT_NODE;
    if (target && spec.labels?.flowNodeId === target) process.kill(process.pid, 'SIGKILL');
    return handle as import('@itookit/durable-kernel').TaskHandle<O>;
};

const setShared = Kernel.prototype.setShared;
Kernel.prototype.setShared = async function<T extends import('@itookit/durable-kernel').JsonValue>(sessionId: string,
    key: string, value: T, options?: import('@itookit/durable-kernel').SharedStateWriteOptions) {
    const target = process.env.MINDOS_TEST_COMPLETED_INSTANCE;
    const completed = (value as { completed?: string[] } | null)?.completed;
    if (target && key.endsWith('.scheduler') && completed?.includes(target)) process.kill(process.pid, 'SIGKILL');
    return setShared.call(this, sessionId, key, value, options) as Promise<import('@itookit/durable-kernel').SharedStateEntry<T>>;
};

// The CLI YAML schema does not expose delegation yet. Use the real compiled Agent
// connection configuration and inject the public DagRunSpec before it is persisted.
const submitFlow = DurableFlowExecutor.prototype.submit;
DurableFlowExecutor.prototype.submit = function(sessionId, spec, parameters) {
    if (process.env.MINDOS_TEST_DELEGATION === '1') {
        const parent = spec.nodes[0];
        const config = structuredClone(parent.config) as Record<string, unknown>;
        parent.config = { ...config, delegation: {
            enabled: true, toolName: 'delegate_tasks',
            resolvedTemplate: { plugin: 'builtin.agent', pluginVersion: '1.0.0', capabilities: [],
                config: { ...config, messages: [{ role: 'user', content: 'Handle one payload' }] } },
            fanout: { maxTasks: 2, maxConcurrency: 1, maxDepth: 1, order: 'sequential' },
            failure: { policy: 'fail-fast' },
        } } as typeof parent.config;
    }
    return submitFlow.call(this, sessionId, spec, parameters);
};

await import('../../src/cli');
