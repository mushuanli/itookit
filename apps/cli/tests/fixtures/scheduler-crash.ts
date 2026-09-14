import { Kernel } from '@itookit/durable-kernel';

// Inject only at public host boundaries; the killed process never rewrites durable state.
const submit = Kernel.prototype.submit;
Kernel.prototype.submit = async function<I, O>(sessionId: string, spec: import('@itookit/durable-kernel').TaskSpec<I>, options?: import('@itookit/durable-kernel').LeaseGuardOptions) {
    const handle = await submit.call(this, sessionId, spec, options);
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

await import('../../src/cli');
