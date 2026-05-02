// @file: tools/src/tools/Task/TaskTools.ts
// Task management tools (TaskCreate, TaskGet, TaskList, TaskUpdate).
// State lives in ToolUseContext.appState so each agent session is isolated.

import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../core/Tool';
import { lazySchema } from '../../core/lazySchema';
import type { ToolUseContext } from '../../core/types';
import {
  TASK_CREATE_NAME, TASK_GET_NAME, TASK_LIST_NAME, TASK_UPDATE_NAME,
  TASK_CREATE_DESCRIPTION, TASK_GET_DESCRIPTION, TASK_LIST_DESCRIPTION, TASK_UPDATE_DESCRIPTION,
} from './prompt';

// ── Task data type ──

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  metadata?: Record<string, unknown>;
}

// ── Session-scoped store helpers ──
// State is stored in context.appState so concurrent agent sessions stay isolated.

const STORE_KEY = 'taskStore';
const NEXT_ID_KEY = 'taskNextId';

function getStore(context: ToolUseContext): Record<string, TaskItem> {
  if (!context.appState) return {};
  if (!context.appState[STORE_KEY]) {
    const store: Record<string, TaskItem> = {};
    context.setAppState?.(STORE_KEY, store);
    return store;
  }
  return context.appState[STORE_KEY] as Record<string, TaskItem>;
}

function allocId(context: ToolUseContext): string {
  if (!context.appState) return String(Date.now());
  const n = ((context.appState[NEXT_ID_KEY] as number) ?? 1);
  context.setAppState?.(NEXT_ID_KEY, n + 1);
  return String(n);
}

// ── TaskCreate ──

const createInputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to attach'),
  }),
);
type CreateInput = ReturnType<typeof createInputSchema>;

const createOutputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
    }),
  }),
);
type CreateOutput = z.infer<ReturnType<typeof createOutputSchema>>;

export const TaskCreateTool = buildTool({
  name: TASK_CREATE_NAME,
  searchHint: 'create structured task items',
  maxResultSizeChars: 10_000,

  async description() { return TASK_CREATE_DESCRIPTION; },
  userFacingName(input) {
    return input?.subject ? `Create ${input.subject}` : 'Create Task';
  },
  getToolUseSummary(input) {
    return input?.subject ?? null;
  },
  getActivityDescription(input) {
    return input?.subject ? `Creating task: ${input.subject}` : 'Creating task';
  },

  get inputSchema(): CreateInput { return createInputSchema(); },
  get outputSchema() { return createOutputSchema(); },

  isConcurrencySafe() { return false; },
  isReadOnly() { return false; },

  async prompt() { return TASK_CREATE_DESCRIPTION; },

  async call(input, context) {
    const store = getStore(context);
    const id = allocId(context);
    const task: TaskItem = {
      id,
      subject: input.subject,
      description: input.description,
      status: 'pending',
      metadata: input.metadata ?? {},
    };
    store[id] = task;
    return { data: { task: { id: task.id, subject: task.subject, description: task.description, status: task.status } } };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${output.task.id} created: ${output.task.subject}`,
    };
  },
} satisfies ToolDef<CreateInput, CreateOutput>);

// ── TaskGet ──

const getInputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().describe('The ID of the task to retrieve'),
  }),
);
type GetInput = ReturnType<typeof getInputSchema>;

const getOutputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
    }).nullable(),
  }),
);
type GetOutput = z.infer<ReturnType<typeof getOutputSchema>>;

export const TaskGetTool = buildTool({
  name: TASK_GET_NAME,
  searchHint: 'get task details by ID',
  maxResultSizeChars: 10_000,

  async description() { return TASK_GET_DESCRIPTION; },
  userFacingName(input) {
    return input?.task_id ? `Get Task #${input.task_id}` : 'Get Task';
  },
  getToolUseSummary(input) {
    return input?.task_id ? `#${input.task_id}` : null;
  },

  get inputSchema(): GetInput { return getInputSchema(); },
  get outputSchema() { return getOutputSchema(); },

  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  async prompt() { return TASK_GET_DESCRIPTION; },

  async call(input, context) {
    const store = getStore(context);
    const task = store[input.task_id];
    if (!task || task.status === 'deleted') {
      return { data: { task: null } };
    }
    return {
      data: {
        task: { id: task.id, subject: task.subject, description: task.description, status: task.status },
      },
    };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (!output.task) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'Task not found' };
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${output.task.id} [${output.task.status}]: ${output.task.subject}\n${output.task.description}`,
    };
  },
} satisfies ToolDef<GetInput, GetOutput>);

// ── TaskList ──

const listInputSchema = lazySchema(() => z.strictObject({}));
type ListInput = ReturnType<typeof listInputSchema>;

const listOutputSchema = lazySchema(() =>
  z.object({
    tasks: z.array(z.object({
      id: z.string(),
      subject: z.string(),
      status: z.string(),
    })),
  }),
);
type ListOutput = z.infer<ReturnType<typeof listOutputSchema>>;

export const TaskListTool = buildTool({
  name: TASK_LIST_NAME,
  searchHint: 'list all task items',
  maxResultSizeChars: 50_000,

  async description() { return TASK_LIST_DESCRIPTION; },
  userFacingName() { return 'Task List'; },

  get inputSchema(): ListInput { return listInputSchema(); },
  get outputSchema() { return listOutputSchema(); },

  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  async prompt() { return TASK_LIST_DESCRIPTION; },

  async call(_input, context) {
    const store = getStore(context);
    const tasks = Object.values(store)
      .filter((t) => t.status !== 'deleted')
      .map((t) => ({ id: t.id, subject: t.subject, status: t.status }));
    return { data: { tasks } };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.tasks.length === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'No tasks' };
    }
    const lines = output.tasks.map((t) => `- [${t.status}] #${t.id}: ${t.subject}`);
    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') };
  },
} satisfies ToolDef<ListInput, ListOutput>);

// ── TaskUpdate ──

const updateInputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().describe('The ID of the task to update'),
    status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).optional(),
    subject: z.string().optional(),
    description: z.string().optional(),
  }),
);
type UpdateInput = ReturnType<typeof updateInputSchema>;

const updateOutputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
    }).nullable(),
  }),
);
type UpdateOutput = z.infer<ReturnType<typeof updateOutputSchema>>;

export const TaskUpdateTool = buildTool({
  name: TASK_UPDATE_NAME,
  searchHint: 'update task status or details',
  maxResultSizeChars: 10_000,

  async description() { return TASK_UPDATE_DESCRIPTION; },
  userFacingName(input) {
    return input?.task_id ? `Update Task #${input.task_id}` : 'Update Task';
  },
  getToolUseSummary(input) {
    return input?.task_id ? `#${input.task_id}` : null;
  },
  getActivityDescription(input) {
    return input?.task_id ? `Updating Task #${input.task_id}` : 'Updating task';
  },

  get inputSchema(): UpdateInput { return updateInputSchema(); },
  get outputSchema() { return updateOutputSchema(); },

  isConcurrencySafe() { return false; },
  isReadOnly() { return false; },

  async prompt() { return TASK_UPDATE_DESCRIPTION; },

  async call(input, context) {
    const store = getStore(context);
    const task = store[input.task_id];
    if (!task) {
      return { data: { task: null } };
    }
    if (input.status) task.status = input.status;
    if (input.subject) task.subject = input.subject;
    if (input.description) task.description = input.description;
    // Mutation is in-place on the appState object reference — no setAppState needed.
    return {
      data: {
        task: { id: task.id, subject: task.subject, description: task.description, status: task.status },
      },
    };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (!output.task) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'Task not found' };
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${output.task.id} updated to [${output.task.status}]: ${output.task.subject}`,
    };
  },
} satisfies ToolDef<UpdateInput, UpdateOutput>);
