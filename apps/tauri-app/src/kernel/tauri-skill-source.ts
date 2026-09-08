import type { ToolVFSContext } from '@itookit/common';
import { SessionFileSkillSource } from '@itookit/kernel-adapters';
import { parse } from 'yaml';

/** Tauri supplies YAML parsing; discovery remains shared with the headless CLI. */
export class TauriSkillSource extends SessionFileSkillSource {
    constructor(fs: Pick<ToolVFSContext, 'readFile' | 'listFiles'>, projectRoot: string) {
        super(fs, projectRoot, parse);
    }
}
