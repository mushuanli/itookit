// @file: llm-harness/src/tools/index.ts
// Built-in tool registry.
//
// Static tools (no runtime deps): registered in ToolDeviceDriver constructor via BUILTIN_TOOLS.
// Dynamic tools (need live service references): registered in AgentDeviceDriver.setServices()
//   via createLoadSkillHandler(skillService) and createDelegateTaskHandler(router).

export { fileReadMeta, fileReadDefinition, fileReadHandler } from './file-read';
export { fileWriteMeta, fileWriteDefinition, fileWriteHandler } from './file-write';
export { shellExecMeta, shellExecDefinition, shellExecHandler } from './shell-exec';
export { globSearchMeta, globSearchDefinition, globSearchHandler } from './glob-search';
export { grepSearchMeta, grepSearchDefinition, grepSearchHandler } from './grep-search';
// Dynamic tool metadata (handlers are factories, registered separately)
export { loadSkillMeta, loadSkillDefinition, createLoadSkillHandler } from './load-skill';
export { delegateTaskMeta, delegateTaskDefinition, createDelegateTaskHandler } from './delegate-task';

import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';
import { fileReadMeta, fileReadDefinition, fileReadHandler } from './file-read';
import { fileWriteMeta, fileWriteDefinition, fileWriteHandler } from './file-write';
import { shellExecMeta, shellExecDefinition, shellExecHandler } from './shell-exec';
import { globSearchMeta, globSearchDefinition, globSearchHandler } from './glob-search';
import { grepSearchMeta, grepSearchDefinition, grepSearchHandler } from './grep-search';

export interface BuiltinToolEntry {
    meta: ToolMeta;
    definition: ToolDefinition;
    handler: ToolHandler;
}

/**
 * Statically-registered built-in tools (no runtime service dependencies).
 * Loaded by ToolDeviceDriver at construction time.
 *
 * Dynamic tools (load_skill, delegate_task) are NOT listed here because their
 * handlers require a live ISkillService / ISubAgentRouter reference and are
 * registered by AgentDeviceDriver.setServices() after services are wired.
 */
export const BUILTIN_TOOLS: BuiltinToolEntry[] = [
    { meta: fileReadMeta,    definition: fileReadDefinition,    handler: fileReadHandler },
    { meta: fileWriteMeta,   definition: fileWriteDefinition,   handler: fileWriteHandler },
    { meta: shellExecMeta,   definition: shellExecDefinition,   handler: shellExecHandler },
    { meta: globSearchMeta,  definition: globSearchDefinition,  handler: globSearchHandler },
    { meta: grepSearchMeta,  definition: grepSearchDefinition,  handler: grepSearchHandler },
];
