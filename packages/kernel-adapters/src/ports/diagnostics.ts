import type { LLMLogSink } from '@itookit/driver-llm/contracts';

export interface KernelAdapterDiagnostics {
    logger?: LLMLogSink;
    /** Host presentation for a missing process capability. */
    processUnavailableMessage?: () => string;
}

export const silentAdapterLog: LLMLogSink = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
