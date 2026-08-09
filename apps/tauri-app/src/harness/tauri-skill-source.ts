import type {
    SkillDefinition,
    SkillFrontmatter,
    SkillScopeLevel,
} from '@itookit/common';
import {
    extractCompactInstructions,
    type SkillScopeSnapshot,
    type SkillSource,
} from '@itookit/coreutils';
import { parse } from 'yaml';
import type { TauriFsOps } from '../fs/tauri-fs-ops';

export class TauriSkillSource implements SkillSource {
    constructor(
        private readonly fs: TauriFsOps,
        private readonly projectRoot: string,
    ) {}

    async loadScope(cwd: string): Promise<SkillScopeSnapshot> {
        const roots = scopeRoots(this.projectRoot, cwd);
        const skills = (await Promise.all(roots.map(root => this.loadDirectory(
            join(root, '_agent/skills'),
            scopeLevel(root, roots),
            root,
        )))).flat();
        return {
            cwd,
            skills,
            agentInstructions: await this.readText(join(this.projectRoot, '_agent/AGENT.md')) ?? '',
        };
    }

    async loadDirectory(
        dirPath: string,
        scope: SkillScopeLevel,
        scopeRoot: string,
    ): Promise<SkillDefinition[]> {
        const entries = await this.fs.readDir(dirPath);
        const loaded = await Promise.all(entries.filter(entry => entry.isDirectory).map(entry =>
            this.loadSkill(join(dirPath, entry.name), scope, scopeRoot)));
        return loaded.filter((skill): skill is SkillDefinition => Boolean(skill));
    }

    private async loadSkill(
        dirPath: string,
        scopeLevel: SkillScopeLevel,
        scopeRoot: string,
    ): Promise<SkillDefinition | null> {
        const raw = await this.readText(join(dirPath, 'SKILL.md'));
        if (!raw) return null;
        const parsed = parseSkillMarkdown(raw);
        if (!parsed) return null;
        return toSkillDefinition(parsed.frontmatter, parsed.body, dirPath, scopeLevel, scopeRoot);
    }

    private async readText(path: string): Promise<string | null> {
        const content = await this.fs.readFile(path);
        return content ? new TextDecoder().decode(content) : null;
    }
}

interface ParsedSkill {
    frontmatter: SkillFrontmatter;
    body: string;
}

function parseSkillMarkdown(raw: string): ParsedSkill | null {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return null;
    const frontmatter = parse(match[1]) as SkillFrontmatter;
    if (!frontmatter?.name) return null;
    return { frontmatter, body: raw.slice(match[0].length).trim() };
}

function toSkillDefinition(
    frontmatter: SkillFrontmatter,
    markdown: string,
    dirPath: string,
    scopeLevel: SkillScopeLevel,
    scopeRoot: string,
): SkillDefinition {
    const { body, compact } = extractCompactInstructions(markdown);
    const reference = !frontmatter['trigger-strategy']
        || frontmatter['trigger-strategy'] === 'reference';
    return {
        id: skillId(frontmatter.name),
        name: frontmatter.name,
        description: frontmatter.description ?? '',
        type: 'prompt', enabled: true, instructions: body, tools: [], triggerPatterns: [],
        autoLoad: reference, priority: frontmatter.priority ?? 50,
        triggerStrategy: frontmatter['trigger-strategy'] ?? 'reference',
        source: 'filesystem', scopeLevel, scopeRoot,
        disableModelInvocation: frontmatter['disable-model-invocation'] ?? false,
        globs: frontmatter.globs ?? [], compact, referencePaths: frontmatter.references ?? [],
        templatePath: frontmatter.template, fsRoot: dirPath,
        supportsSubagent: Boolean(frontmatter.subagent), subagentRole: frontmatter.subagent?.role,
        taskProgram: validTaskProgram(frontmatter['task-program']),
    };
}

function validTaskProgram(
    value: SkillFrontmatter['task-program'],
): SkillDefinition['taskProgram'] {
    if (!value || typeof value.kind !== 'string' || typeof value.version !== 'string') return undefined;
    if (!value.kind.trim() || !value.version.trim()) return undefined;
    return { kind: value.kind, version: value.version };
}

function scopeRoots(projectRoot: string, cwd: string): string[] {
    if (cwd === projectRoot) return [projectRoot];
    if (!cwd.startsWith(`${projectRoot}/`)) return [projectRoot];
    const suffix = cwd.slice(projectRoot.length + 1).split('/').filter(Boolean);
    return suffix.reduce<string[]>((roots, part) => [...roots, join(roots.at(-1)!, part)], [projectRoot]);
}

function scopeLevel(root: string, roots: string[]): SkillScopeLevel {
    if (root === roots[0]) return 'global-fs';
    if (root === roots.at(-1)) return 'local-fs';
    return 'parent-fs';
}

function join(...parts: string[]): string {
    const absolute = parts[0]?.startsWith('/') ?? false;
    const value = parts.flatMap(part => part.split('/')).filter(Boolean).join('/');
    return absolute ? `/${value}` : value;
}

function skillId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
