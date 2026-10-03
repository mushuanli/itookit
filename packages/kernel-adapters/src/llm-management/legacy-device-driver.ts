import { LLMDeviceDriver as ManagementDriver, type LLMDeviceDriverOptions } from './device/llm-device-driver';
import type { IVFSManager } from '@itookit/vfs-core';
import { createMindosLlmPresets, firstChatModelConnection } from './presets';

/** Compatibility constructor; new hosts select presets explicitly through the core entry. */
export class LLMDeviceDriver extends ManagementDriver {
    constructor(vfs: IVFSManager, options: LLMDeviceDriverOptions = {}) {
        super(vfs, { ...options, presets: options.presets ?? createMindosLlmPresets(),
            providerConnectionPolicy: options.providerConnectionPolicy ?? firstChatModelConnection });
    }
}
