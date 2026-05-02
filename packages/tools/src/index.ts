// @file: tools/src/index.ts
// Public API for @itookit/tools

// ── Core ──
export { buildTool, toolMatchesName, findToolByName } from './core/Tool';
export type { Tool, ToolDef, AnyObject } from './core/Tool';
export { lazySchema } from './core/lazySchema';
export { globToRegex } from './core/globToRegex';
export type {
  ValidationResult,
  PermissionResult,
  ToolUseContext,
  ToolResult,
  ToolResultBlockParam,
  ToolUseBlockParam,
  INativeShell,
  NativeShellResult,
} from './core/types';
export { createNodeNativeShell } from './core/node-native-shell';

// ── Tool imports (used for both exports and BUILTIN_TOOLS registry) ──
import { FileReadTool } from './tools/FileRead/FileReadTool';
import { FileWriteTool } from './tools/FileWrite/FileWriteTool';
import { FileEditTool } from './tools/FileEdit/FileEditTool';
import { GlobTool } from './tools/Glob/GlobTool';
import { GrepTool } from './tools/Grep/GrepTool';
import { BashTool, createBashTool } from './tools/Bash/BashTool';
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from './tools/Task/TaskTools';
import { EnterPlanModeTool, ExitPlanModeTool, isPlanModeActive, getPlanContent } from './tools/PlanMode/PlanModeTools';
import { AskUserQuestionTool, createAskUserQuestionTool } from './tools/AskUserQuestion/AskUserQuestionTool';
import { WebFetchTool } from './tools/WebFetch/WebFetchTool';
import type { Tool } from './core/Tool';

// ── File tools ──
export { FileReadTool };
export type { Output as FileReadOutput } from './tools/FileRead/FileReadTool';
export { FileWriteTool };
export type { Output as FileWriteOutput } from './tools/FileWrite/FileWriteTool';
export { FileEditTool };
export type { Output as FileEditOutput } from './tools/FileEdit/FileEditTool';

// ── Search tools ──
export { GlobTool };
export type { Output as GlobOutput } from './tools/Glob/GlobTool';
export { GrepTool };
export type { Output as GrepOutput } from './tools/Grep/GrepTool';

// ── Shell tool ──
export { BashTool, createBashTool };
export type { Output as BashOutput } from './tools/Bash/BashTool';

// ── Skill tool ──
export { createSkillTool } from './tools/Skill/SkillTool';
export type { Output as SkillOutput } from './tools/Skill/SkillTool';

// ── Agent tool ──
export { createAgentTool } from './tools/Agent/AgentTool';
export type { Output as AgentOutput } from './tools/Agent/AgentTool';

// ── Task tools ──
export { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool };
export type { TaskItem } from './tools/Task/TaskTools';

// ── Plan mode tools ──
export { EnterPlanModeTool, ExitPlanModeTool, isPlanModeActive, getPlanContent };

// ── User interaction ──
export { AskUserQuestionTool, createAskUserQuestionTool };
export type {
  Output as AskUserQuestionOutput,
  AskUserQuestionCallback,
  Question as AskUserQuestion,
} from './tools/AskUserQuestion/AskUserQuestionTool';

// ── Web tools ──
export { WebFetchTool };
export type { Output as WebFetchOutput } from './tools/WebFetch/WebFetchTool';

// ── Adapter ──
export { ToolDeviceDriver } from './adapters/tool-device-driver';

// ── Tool registry (all built-in static tools) ──

/**
 * All static built-in tools (no runtime service dependencies).
 * Use createSkillTool(skillService) and createAgentTool(router) for dynamic tools.
 */
export const BUILTIN_TOOLS: Tool[] = [
  // File
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  // Search
  GlobTool,
  GrepTool,
  // Shell
  BashTool,
  // Task
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
  // Plan mode
  EnterPlanModeTool,
  ExitPlanModeTool,
  // User
  AskUserQuestionTool,
  // Web
  WebFetchTool,
];
