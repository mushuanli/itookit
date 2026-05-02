// @file: llm-harness/src/tools/index.ts
// Harness-specific tool registry.
//
// Static tools (file-*, glob-*, grep-*, shell-*, etc.) have been migrated
// to @itookit/tools and are no longer here. See packages/tools/src/index.ts.
//
// The following tools remain harness-specific because they require live
// service references (ISkillService, ISubAgentRouter, IAgentLookup, etc.)
// that are only available after AgentDeviceDriver.setServices() wires everything.

export { loadSkillMeta, loadSkillDefinition, createLoadSkillHandler } from './load-skill';
export { delegateTaskMeta, delegateTaskDefinition, createDelegateTaskHandler } from './delegate-task';

import type { ToolMeta, ToolDefinition } from '@itookit/common';
import type { Tool } from '@itookit/tools';

export interface BuiltinToolEntry {
    meta: ToolMeta;
    definition: ToolDefinition;
    tool?: Tool; // Optional: new-style Tool from @itookit/tools
}
