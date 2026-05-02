// @file: tools/src/tools/Grep/GrepTool.ts
// Grep content search tool.
//
// Execution priority:
//   1. context.shell?.capabilities.ripgrep → rg --json  (10-100x faster)
//   2. context.vfs                          → VFS parallel reads (browser)
//   3. fallback                             → Node.js manual directory walk

import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../core/Tool';
import { lazySchema } from '../../core/lazySchema';
import { GREP_TOOL_NAME, DESCRIPTION } from './prompt';
import { globToRegex } from '../../core/globToRegex';
import type { ToolUseContext } from '../../core/types';

const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The regular expression pattern to search for in file contents'),
    glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts", "**/*.tsx")'),
    path: z.string().optional().describe('File or directory to search in. Defaults to current working directory.'),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    matches: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        content: z.string(),
      }),
    ).describe('Array of matched lines with file path and line number'),
    durationMs: z.number().describe('Time taken in milliseconds'),
    numMatches: z.number().describe('Total number of matches found'),
    truncated: z.boolean().describe('Whether results were truncated'),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;
export type Match = Output['matches'][number];

// ── Ignored directories ──
const IGNORED_DIRS = [
  'node_modules', 'dist', '.git', '.svn', 'build', 'out',
  '.next', '.nuxt', '.cache', 'coverage', '__pycache__',
];
const IGNORED_DIRS_SET = new Set(IGNORED_DIRS);

// ── ripgrep path ──

/**
 * Build rg exclusion flags from IGNORED_DIRS.
 * rg --glob '!{node_modules,dist,...}/**' excludes all of them in one flag.
 */
const RG_EXCLUDE_GLOB = `!{${IGNORED_DIRS.join(',')}}/**`;

interface RgMatchData {
  path: { text?: string; bytes?: string };
  lines: { text?: string; bytes?: string };
  line_number: number;
}

function rgPathText(field: { text?: string; bytes?: string }): string {
  return field.text ?? Buffer.from(field.bytes ?? '', 'base64').toString('utf-8');
}

async function grepWithRipgrep(
  input: { pattern: string; glob?: string; path?: string },
  context: ToolUseContext,
  limit: number,
): Promise<Output> {
  const start = Date.now();
  const searchDir = input.path ?? context.cwd;

  const args = [
    '--json',
    '--case-insensitive',
    '--glob', RG_EXCLUDE_GLOB,
    '--max-filesize', '1M',
  ];
  if (input.glob) {
    args.push('--glob', input.glob);
  }
  args.push('-e', input.pattern, searchDir);

  const result = await context.shell!.exec('rg', args, {
    cwd: context.cwd,
    timeoutMs: context.timeoutMs,
    signal: context.signal,
  });

  const matches: Match[] = [];
  let truncated = false;

  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    let obj: { type: string; data: RgMatchData };
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'match') continue;

    const d = obj.data;
    matches.push({
      file: rgPathText(d.path),
      line: d.line_number,
      content: rgPathText(d.lines).replace(/\n$/, ''),
    });

    if (matches.length >= limit) {
      truncated = true;
      break;
    }
  }

  return {
    matches,
    durationMs: Date.now() - start,
    numMatches: matches.length,
    truncated,
  };
}

// ── VFS path (browser) ──

async function grepVFS(
  input: { pattern: string; glob?: string; path?: string },
  context: ToolUseContext & { vfs: NonNullable<ToolUseContext['vfs']> },
  contentRegex: RegExp,
  fileRegex: RegExp | null,
  limit: number,
): Promise<Output> {
  const start = Date.now();
  const searchDir = input.path ?? context.cwd;

  const allFiles = await context.vfs.listFiles(searchDir).catch(() => [] as string[]);
  const candidates = fileRegex ? allFiles.filter((f) => fileRegex.test(f)) : allFiles;

  const texts = await Promise.all(
    candidates.map((p) => context.vfs.readFile(p).catch(() => null)),
  );

  const matches: Match[] = [];
  for (let fi = 0; fi < candidates.length && matches.length < limit; fi++) {
    const text = texts[fi];
    if (!text) continue;
    const lines = text.split('\n');
    for (let li = 0; li < lines.length && matches.length < limit; li++) {
      if (contentRegex.test(lines[li])) {
        matches.push({ file: candidates[fi], line: li + 1, content: lines[li] });
      }
    }
  }

  return {
    matches,
    durationMs: Date.now() - start,
    numMatches: matches.length,
    truncated: matches.length >= limit,
  };
}

// ── Node.js path ──

function isBinary(buf: Uint8Array): boolean {
  for (let i = 0; i < Math.min(buf.length, 512); i++) {
    const b = buf[i];
    if (b === 0 || (b < 7 && b !== 0)) return true;
  }
  return false;
}

async function walkAndSearch(
  dir: string, baseDir: string,
  fileRegex: RegExp | null, contentRegex: RegExp,
  matches: Match[], limit: number, signal?: AbortSignal,
): Promise<void> {
  if (matches.length >= limit || signal?.aborted) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = await import('node:fs/promises' as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodePath = await import('node:path' as any);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (matches.length >= limit || signal?.aborted) break;
    if (IGNORED_DIRS_SET.has(entry.name)) continue;
    const full = nodePath.join(dir, entry.name);
    const rel = nodePath.relative(baseDir, full);
    if (entry.isDirectory()) {
      await walkAndSearch(full, baseDir, fileRegex, contentRegex, matches, limit, signal);
    } else if (entry.isFile() && (!fileRegex || fileRegex.test(rel))) {
      const buf = await fs.readFile(full).catch(() => null);
      if (!buf || isBinary(buf)) continue;
      const lines = (buf as Buffer).toString('utf-8').split('\n');
      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (contentRegex.test(lines[i])) {
          matches.push({ file: rel, line: i + 1, content: lines[i] });
        }
      }
    }
  }
}

// ── Tool ──

export const GrepTool = buildTool({
  name: GREP_TOOL_NAME,
  searchHint: 'search file contents with regex patterns',
  maxResultSizeChars: 100_000,

  async description() { return DESCRIPTION; },

  userFacingName(input) {
    return input?.pattern ? `Grep "${input.pattern}"` : 'Grep';
  },

  getToolUseSummary(input) {
    return input?.pattern ? `"${input.pattern}"` : null;
  },

  getActivityDescription(input) {
    return input?.pattern ? `Searching ${input.pattern}` : 'Searching';
  },

  get inputSchema(): InputSchema { return inputSchema(); },
  get outputSchema(): OutputSchema { return outputSchema(); },

  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  async prompt() { return DESCRIPTION; },

  async call(input, context) {
    const limit = 50;
    const { pattern, glob, path } = input;

    // ── 1. ripgrep (fastest — Node.js or Tauri with rg available) ──
    if (context.shell?.capabilities.ripgrep) {
      try {
        return { data: await grepWithRipgrep({ pattern, glob, path }, context, limit) };
      } catch {
        // rg failed unexpectedly — fall through to Node.js walker
      }
    }

    // Build regex for non-rg paths
    let contentRegex: RegExp;
    try {
      contentRegex = new RegExp(pattern, 'i');
    } catch {
      contentRegex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const fileRegex = glob ? globToRegex(glob) : null;
    const searchDir = path ?? context.cwd;

    // ── 2. VFS (browser — parallel reads) ──
    if (context.vfs) {
      return { data: await grepVFS({ pattern, glob, path }, { ...context, vfs: context.vfs }, contentRegex, fileRegex, limit) };
    }

    // ── 3. Node.js manual walk ──
    const start = Date.now();
    const matches: Match[] = [];
    await walkAndSearch(searchDir, searchDir, fileRegex, contentRegex, matches, limit, context.signal);
    return {
      data: {
        matches,
        durationMs: Date.now() - start,
        numMatches: matches.length,
        truncated: matches.length >= limit,
      },
    };
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.matches.length === 0) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'No matches found' };
    }
    const lines = output.matches.map((m) => `${m.file}:${m.line}: ${m.content}`);
    if (output.truncated) {
      lines.push('(Results truncated. Consider using a more specific search.)');
    }
    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') };
  },
} satisfies ToolDef<InputSchema, Output>);
