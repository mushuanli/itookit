// @file: llm-harness/src/skills/fs-skill-loader.ts
// 文件系统 Skill 加载器：扫描 _agent/skills/ 目录，解析 SKILL.md。
// 浏览器安全：动态 import node:fs / node:path，失败则静默降级。

import type { SkillDefinition } from '@itookit/common';
import type { FSSkillDirectory, ScopeEntry, SkillFrontmatter } from '@itookit/common';
import { extractCompactInstructions } from './compact-extractor';

const AGENT_DIR = '_agent';
const SKILLS_SUBDIR = 'skills';
const SKILL_MD = 'SKILL.md';

// ── Node.js 模块动态加载（浏览器安全）──────────────────────────────────────

async function getFs(): Promise<typeof import('node:fs/promises') | null> {
    try {
        return await import('node:fs/promises');
    } catch {
        return null;
    }
}

async function getPath(): Promise<typeof import('node:path') | null> {
    try {
        return await import('node:path');
    } catch {
        return null;
    }
}

// ── 项目根查找 ──────────────────────────────────────────────────────────────

/**
 * 向上查找包含 `_agent/` 目录的最近祖先目录（含 cwd 自身）。
 * 浏览器环境或 fs 不可用时返回 null。
 */
export async function findProjectRoot(cwd: string): Promise<string | null> {
    const fs = await getFs();
    const path = await getPath();
    if (!fs || !path) return null;

    let dir = cwd;
    while (true) {
        const agentDir = path.join(dir, AGENT_DIR);
        try {
            const stat = await fs.stat(agentDir);
            if (stat.isDirectory()) return dir;
        } catch {
            // not found, keep going up
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null; // reached FS root
        dir = parent;
    }
}

// ── 作用域继承链构建 ────────────────────────────────────────────────────────

/**
 * 从项目根到当前 CWD 构建 skill 作用域继承链。
 *
 * 规则：
 * - projectRoot/_agent/skills/ → global-fs
 * - 中间祖先/_agent/skills/    → parent-fs（可多层）
 * - cwd/_agent/skills/         → local-fs
 */
export function buildScopeEntries(
    projectRoot: string,
    cwd: string,
    pathModule: { join: (...p: string[]) => string; relative: (f: string, t: string) => string; sep: string }
): ScopeEntry[] {
    const entries: ScopeEntry[] = [];

    // Collect all directories from projectRoot to cwd (inclusive)
    const relatives: string[] = [];
    let cur = cwd;
    while (true) {
        relatives.unshift(cur);
        if (cur === projectRoot) break;
        const parent = pathModule.join(cur, '..');
        if (parent === cur) break;
        cur = parent;
    }

    for (let i = 0; i < relatives.length; i++) {
        const dir = relatives[i];
        const skillsDir = pathModule.join(dir, AGENT_DIR, SKILLS_SUBDIR);
        let scopeLevel: ScopeEntry['scopeLevel'];
        if (i === 0) {
            scopeLevel = 'global-fs';
        } else if (i === relatives.length - 1) {
            scopeLevel = 'local-fs';
        } else {
            scopeLevel = 'parent-fs';
        }
        entries.push({ dirPath: skillsDir, scopeLevel, scopeRoot: dir });
    }

    return entries;
}

// ── YAML frontmatter 解析 ──────────────────────────────────────────────────

/**
 * 最小化 YAML frontmatter 解析（不引入 yaml 依赖）。
 * 仅支持 SKILL.md 所用的简单键值、列表结构。
 */
function parseFrontmatter(raw: string): SkillFrontmatter | null {
    const match = raw.match(/^---\r?\n([\s\S]*?)\n---/);
    if (!match) return null;

    const lines = match[1].split('\n');
    const result: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let currentList: string[] | null = null;

    for (const line of lines) {
        // List item
        if (/^\s+-\s+/.test(line) && currentKey && currentList) {
            currentList.push(line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
            continue;
        }

        // Key: value
        const kvMatch = line.match(/^([\w-]+):\s*(.*)/);
        if (kvMatch) {
            // Commit any pending list
            if (currentKey && currentList) {
                result[currentKey] = currentList;
            }
            const [, key, val] = kvMatch;
            const trimmed = val.trim();
            if (trimmed === '' || trimmed === '[]') {
                currentKey = key;
                currentList = trimmed === '[]' ? [] : null;
                if (trimmed === '') {
                    // value will be a list on next lines
                    currentList = [];
                } else {
                    result[key] = [];
                    currentKey = null;
                    currentList = null;
                }
                continue;
            }
            currentKey = null;
            currentList = null;
            if (trimmed === 'true') { result[key] = true; }
            else if (trimmed === 'false') { result[key] = false; }
            else if (/^\d+$/.test(trimmed)) { result[key] = parseInt(trimmed, 10); }
            else { result[key] = trimmed.replace(/^["']|["']$/g, ''); }
            continue;
        }

        // subagent block key (indented)
        const subMatch = line.match(/^\s+([\w-]+):\s*(.*)/);
        if (subMatch && currentKey === 'subagent') {
            if (typeof result['subagent'] !== 'object' || !result['subagent']) {
                result['subagent'] = {};
            }
            (result['subagent'] as Record<string, string>)[subMatch[1]] = subMatch[2].trim();
        }
    }

    if (currentKey && currentList) {
        result[currentKey] = currentList;
    }

    return result as unknown as SkillFrontmatter;
}

// ── SKILL.md 加载 ──────────────────────────────────────────────────────────

/**
 * 加载单个 skill 目录（读取 SKILL.md，解析 frontmatter + body + compact）。
 * 返回 null 表示目录不含合法 SKILL.md。
 */
export async function loadFSSkillDirectory(
    dirPath: string
): Promise<FSSkillDirectory | null> {
    const fs = await getFs();
    const path = await getPath();
    if (!fs || !path) return null;

    const skillMdPath = path.join(dirPath, SKILL_MD);
    let raw: string;
    try {
        raw = await fs.readFile(skillMdPath, 'utf-8');
    } catch {
        return null;
    }

    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter?.name) return null;

    // Strip frontmatter block from markdown body
    const bodyRaw = raw.replace(/^---\r?\n[\s\S]*?\n---\r?\n?/, '').trim();
    const { body, compact } = extractCompactInstructions(bodyRaw);

    // Derive skill id from name (kebab-case)
    const skillId = frontmatter.name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

    return {
        dirPath,
        skillId,
        frontmatter,
        instructions: body,
        compact: compact ?? undefined,
    };
}

/**
 * 扫描 _agent/skills/ 目录，返回所有合法 skill 目录信息。
 */
export async function scanScopeEntry(entry: ScopeEntry): Promise<FSSkillDirectory[]> {
    const fs = await getFs();
    const path = await getPath();
    if (!fs || !path) return [];

    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(entry.dirPath, { withFileTypes: true });
    } catch {
        return []; // directory may not exist
    }

    const results: FSSkillDirectory[] = [];
    for (const dirent of entries) {
        if (!dirent.isDirectory()) continue;
        const skillDir = path.join(entry.dirPath, dirent.name);
        const loaded = await loadFSSkillDirectory(skillDir);
        if (loaded) results.push(loaded);
    }
    return results;
}

// ── SkillFrontmatter → SkillDefinition 映射 ────────────────────────────────

/**
 * 将文件系统 skill 目录信息映射为 SkillDefinition（参考设计文档 7.3 节）。
 */
export function fsSkillToSkillDef(
    dir: FSSkillDirectory,
    entry: ScopeEntry
): SkillDefinition {
    const fm = dir.frontmatter;
    const isReference =
        !fm['trigger-strategy'] || fm['trigger-strategy'] === 'reference';

    return {
        id: dir.skillId,
        name: fm.name,
        description: fm.description ?? '',
        type: 'prompt',
        enabled: true,
        instructions: dir.instructions,
        tools: [],
        triggerPatterns: [],
        autoLoad: isReference,
        priority: fm.priority ?? 50,

        // New fields
        triggerStrategy: fm['trigger-strategy'] ?? 'reference',
        source: 'filesystem',
        scopeLevel: entry.scopeLevel,
        scopeRoot: entry.scopeRoot,
        disableModelInvocation: fm['disable-model-invocation'] ?? false,
        globs: fm.globs ?? [],
        compact: dir.compact ?? null,
        correctionLog: fm['correction-log']
            ? { path: fm['correction-log'], enabled: true }
            : undefined,
        referencePaths: fm.references ?? [],
        templatePath: fm.template,
        fsRoot: dir.dirPath,
        supportsSubagent: !!fm.subagent,
        subagentRole: fm.subagent?.role,
    };
}
