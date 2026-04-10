// @file: llm-harness/src/shell/node-shell-runner.ts
// Node.js implementation of IShellRunner.
//
// Renders {{argName}} placeholders in the command template, then spawns
// the rendered command via sh -c. Used to wire shell-type LLMSkills in
// Node.js / Electron / server-side environments.
//
// Inject into LLMDeviceDriver at startup:
//   new LLMDeviceDriver(vfs, { shellRunner: new NodeShellRunner() })

import { spawn } from 'node:child_process';
import type { IShellRunner } from '@itookit/device-llm';

const MAX_OUTPUT = 50_000;

/** Render {{key}} placeholders in a command template. */
function renderTemplate(template: string, args: Record<string, unknown>): string {
    let cmd = template;
    for (const [k, v] of Object.entries(args)) {
        cmd = cmd.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
    return cmd;
}

export class NodeShellRunner implements IShellRunner {
    async run(template: string, args: Record<string, unknown>): Promise<string> {
        const command = renderTemplate(template, args);

        return new Promise((resolve) => {
            const chunks: string[] = [];
            let timedOut = false;

            const proc = spawn('sh', ['-c', command], {
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // 30s hard limit — callers can override via SkillToolBinding.timeoutMs
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, 30_000);

            const onData = (chunk: Buffer) => {
                chunks.push(chunk.toString());
                if (chunks.join('').length > MAX_OUTPUT) proc.kill('SIGTERM');
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', onData);

            proc.on('close', (code) => {
                clearTimeout(timer);
                let output = chunks.join('');
                if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[output truncated]';
                const status = timedOut ? 'timeout' : `exit ${code ?? '?'}`;
                resolve(`$ ${command}\n[${status}]\n${output}`);
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                resolve(`Error spawning command: ${err.message}`);
            });
        });
    }
}
