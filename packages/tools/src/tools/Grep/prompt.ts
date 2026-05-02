// @file: tools/src/tools/Grep/prompt.ts

export const GREP_TOOL_NAME = 'Grep';

export const DESCRIPTION =
  '- A powerful search tool built on ripgrep\n' +
  '- Search for a regex pattern in file contents\n' +
  '- Returns matches in "path:line:content" format\n' +
  '- Supports file glob filtering, case-insensitive search, and context lines\n' +
  '- Automatically skips binary files and ignored directories';

export const PROMPT =
  'Grep: Search file contents with regular expressions. Use this instead of terminal grep/rg. Supports glob filtering, case-insensitive matching, and context lines.';
