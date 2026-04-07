// tools/builtin/file-write.ts

import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

export class FileWriteTool implements ITool {
  readonly name = 'file_write';
  readonly description =
    'Write or edit a file. Supports full content replacement and surgical edits using search/replace blocks.';
  readonly sideEffect = SideEffect.Local;
  readonly timeoutMs = 30_000;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to write to',
          },
          content: {
            type: 'string',
            description: 'Full file content (for new files or full replacement)',
          },
          edits: {
            type: 'array',
            description: 'Surgical edits as search/replace pairs',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string' },
                replace: { type: 'string' },
              },
              required: ['search', 'replace'],
            },
          },
          createDirs: {
            type: 'boolean',
            description: 'Create parent directories if they do not exist',
            default: true,
          },
        },
        required: ['path'],
      },
    };
  }

  isAvailable(): boolean {
    return true;
  }

  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
    const filePath = this.resolvePath(String(args.path), session);
    const content = args.content as string | undefined;
    const edits = args.edits as Array<{ search: string; replace: string }> | undefined;
    const createDirs = args.createDirs !== false;

    if (content !== undefined && edits !== undefined) {
      return "Error: Provide either 'content' or 'edits', not both.";
    }
    if (content === undefined && edits === undefined) {
      return "Error: Must provide either 'content' or 'edits'.";
    }

    if (createDirs) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    if (content !== undefined) {
      return this.writeFull(filePath, content);
    }
    return this.applyEdits(filePath, edits!);
  }

  private writeFull(filePath: string, content: string): string {
    const existed = fs.existsSync(filePath);
    fs.writeFileSync(filePath, content, 'utf-8');
    const lines = content.split('\n').length;
    const action = existed ? 'Updated' : 'Created';
    return `${action}: ${filePath} (${lines} lines)`;
  }

  private applyEdits(
    filePath: string,
    edits: Array<{ search: string; replace: string }>,
  ): string {
    if (!fs.existsSync(filePath)) {
      return `Error: Cannot apply edits to non-existent file: ${filePath}`;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    let applied = 0;
    const failed: string[] = [];

    for (const edit of edits) {
      if (content.includes(edit.search)) {
        content = content.replace(edit.search, edit.replace);
        applied++;
      } else {
        failed.push(edit.search.slice(0, 80));
      }
    }

    fs.writeFileSync(filePath, content, 'utf-8');

    const parts = [`Applied ${applied}/${edits.length} edits to ${filePath}`];
    if (failed.length > 0) {
      parts.push(`Failed to match ${failed.length} patterns:`);
      for (const f of failed) {
        parts.push(`  - '${f}...'`);
      }
    }
    return parts.join('\n');
  }

  private resolvePath(raw: string, session: ISession): string {
    if (path.isAbsolute(raw)) return raw;
    return path.join(session.environment.cwd, raw);
  }
}
