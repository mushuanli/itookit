// @file: tools/src/tools/Glob/GlobTool.ts
// Glob file pattern matching tool.
//
// Execution priority:
//   1. context.shell?.capabilities.fd → fd (3-10x faster, parallel Rayon traversal)
//   2. context.vfs                    → VFS filter (browser)
//   3. fallback                       → Node.js manual directory walk (mtime-sorted)

import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../core/Tool';
import { lazySchema } from '../../core/lazySchema';
import { GLOB_TOOL_NAME, DESCRIPTION } from './prompt';
import { globToRegex } from '../../core/globToRegex';
import type { ToolUseContext } from '../../core/types';

const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. If not specified, the current working directory will be used.',
      ),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    filenames: z.array(z.string()).describe('Array of file paths matching the pattern'),
    durationMs: z.number().describe('Time taken to execute the search in milliseconds'),
    numFiles: z.number().describe('Total number of files found'),
    truncated: z.boolean().describe('Whether results were truncated'),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

// ── Ignored directories ──
const IGNORED_DIRS = [
  'node_modules', 'dist', '.git', '.svn', 'build', 'out',
  '.next', '.nuxt', '.cache', 'coverage', '__pycache__',
];
const IGNORED_DIRS_SET = new Set(IGNORED_DIRS);

// ── fd path ──

async function globWithFd(
  input: { pattern: string; path?: string },
  context: ToolUseContext,
  limit: number,
): Promise<Output> {
  const start = Date.now();
  const searchDir = input.path ?? context.cwd;

  const args = ['--type', 'f', '--max-results', String(limit)];
  // fd uses --exclude per directory (no brace expansion like rg)
  for (const dir of IGNORED_DIRS) args.push('--exclude', dir);
  // fd treats the first non-flag argument as a regex by default;
  // pass the pattern as a glob with --glob.
  args.push('--glob', input.pattern, searchDir);

  const result = await context.shell!.exec('fd', args, {
    cwd: context.cwd,
    timeoutMs: context.timeoutMs,
    signal: context.signal,
  });

  const filenames = result.stdout.split('\n').filter(Boolean);
  // fd outputs absolute paths when searchDir is absolute.
  // Normalise to relative paths using the searchDir prefix.
  const normalized = filenames.map((f) =>
    f.startsWith(searchDir + '/') ? f.slice(searchDir.length + 1) : f,
  );

  return {
    filenames: normalized,
    durationMs: Date.now() - start,
    numFiles: normalized.length,
    // fd --max-results caps the output; if we got exactly limit items, there may be more.
    truncated: normalized.length >= limit,
  };
}

// ── Node.js filesystem walker ──

async function walkDir(
  dir: string, baseDir: string, regex: RegExp,
  results: Array<{ path: string; mtime: number }>,
  limit: number, signal?: AbortSignal,
): Promise<void> {
  if (results.length >= limit || signal?.aborted) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = await import('node:fs/promises' as any);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (results.length >= limit || signal?.aborted) break;
    if (IGNORED_DIRS_SET.has(entry.name)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodePath = await import('node:path' as any);
    const full = nodePath.join(dir, entry.name);
    const rel = nodePath.relative(baseDir, full);
    if (entry.isDirectory()) {
      await walkDir(full, baseDir, regex, results, limit, signal);
    } else if (entry.isFile() && regex.test(rel)) {
      try { results.push({ path: rel, mtime: (await fs.stat(full)).mtimeMs }); }
      catch { results.push({ path: rel, mtime: 0 }); }
    }
  }
}

// ── Tool ──

export const GlobTool = buildTool({
  name: GLOB_TOOL_NAME,
  searchHint: 'find files by name pattern or wildcard',
  maxResultSizeChars: 100_000,

  async description() { return DESCRIPTION; },

  userFacingName(input) {
    return input?.pattern ? `Glob "${input.pattern}"` : 'Glob';
  },

  getToolUseSummary(input) {
    return input?.pattern ? `"${input.pattern}"` : null;
  },

  getActivityDescription(input) {
    const p = input?.pattern;
    return p ? `Finding ${p}` : 'Finding files';
  },

  get inputSchema(): InputSchema { return inputSchema(); },
  get outputSchema(): OutputSchema { return outputSchema(); },

  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  isSearchOrReadCommand() {
    return 'search' as const;
  },

  async prompt() { return DESCRIPTION; },

  async call(input, context) {
    const limit = 100;
    const { pattern, path } = input;
    const searchDir = path ?? context.cwd;

    // ── 1. fd (fastest — Node.js or Tauri with fd available) ──
    if (context.shell?.capabilities.fd) {
      try {
        return { data: await globWithFd({ pattern, path }, context, limit) };
      } catch {
        // fd failed unexpectedly — fall through
      }
    }

    // ── 2. VFS (browser) ──
    if (context.vfs) {
      const start = Date.now();
      const regex = globToRegex(pattern);
      const allFiles = await context.vfs.listFiles(searchDir).catch(() => [] as string[]);
      const matched = allFiles.filter((f) => regex.test(f)).slice(0, limit);
      return {
        data: {
          filenames: matched,
          durationMs: Date.now() - start,
          numFiles: matched.length,
          truncated: matched.length >= limit,
        },
      };
    }

    // ── 3. Node.js manual walk (mtime-sorted) ──
    const start = Date.now();
    const regex = globToRegex(pattern);
    const results: Array<{ path: string; mtime: number }> = [];
    await walkDir(searchDir, searchDir, regex, results, limit, context.signal);
    results.sort((a, b) => b.mtime - a.mtime);
    return {
      data: {
        filenames: results.map((r) => r.path),
        durationMs: Date.now() - start,
        numFiles: results.length,
        truncated: results.length >= limit,
      },
    };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.filenames.length === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'No files found' };
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        ...output.filenames,
        ...(output.truncated
          ? ['(Results are truncated. Consider using a more specific path or pattern.)']
          : []),
      ].join('\n'),
    };
  },
} satisfies ToolDef<InputSchema, Output>);
