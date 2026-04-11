// @file: llm-harness/src/executor/back-pressure.ts
// 反压验证器实现。
//
// Browser safety: spawn is loaded via dynamic import so Vite does not
// statically bundle node:child_process into the browser build.
// In browser environments the dynamic import throws and every rule passes (no-op).

import type { IBackPressureValidator, BackPressureResult, BackPressureRule } from '@itookit/common';

export class BackPressureValidator implements IBackPressureValidator {
    private rules: BackPressureRule[];

    constructor(rules: BackPressureRule[] = []) {
        this.rules = [...rules];
    }

    async checkAfterTool(toolName: string, workingDirectory: string): Promise<BackPressureResult | null> {
        const matching = this.rules.filter(
            (r) => !r.onlyOnFinal && r.afterTools.includes(toolName),
        );
        for (const rule of matching) {
            const result = await this.runRule(rule, workingDirectory);
            if (!result.passed) return result;
        }
        return null;
    }

    async checkBeforeFinal(workingDirectory: string): Promise<BackPressureResult | null> {
        const matching = this.rules.filter((r) => r.onlyOnFinal);
        for (const rule of matching) {
            const result = await this.runRule(rule, workingDirectory);
            if (!result.passed) return result;
        }
        return null;
    }

    addRule(rule: BackPressureRule): void {
        this.rules.push(rule);
    }

    removeRule(ruleName: string): void {
        this.rules = this.rules.filter((r) => r.name !== ruleName);
    }

    getRules(): BackPressureRule[] {
        return [...this.rules];
    }

    private runRule(rule: BackPressureRule, cwd: string): Promise<BackPressureResult> {
        return new Promise(async (resolve) => {
            // Dynamic import keeps node:child_process out of the browser bundle.
            // The destructure triggers the Vite externalized-module getter, which throws
            // in browser; we catch that and treat the rule as passed (no-op).
            let spawnFn: typeof import('node:child_process').spawn;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cp = await import('node:child_process' as any);
                spawnFn = cp.spawn;
            } catch {
                resolve({ passed: true, ruleName: rule.name, errorMessage: '' });
                return;
            }

            const chunks: string[] = [];
            const proc = spawnFn('sh', ['-c', rule.command], {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                resolve({
                    passed: false,
                    ruleName: rule.name,
                    errorMessage: `[timeout after ${rule.timeoutMs}ms] ${chunks.join('')}`,
                });
            }, rule.timeoutMs);

            proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()));

            proc.on('close', (code: number | null) => {
                clearTimeout(timer);
                const output = chunks.join('');
                resolve({
                    passed: code === 0,
                    ruleName: rule.name,
                    errorMessage: code !== 0 ? output : '',
                });
            });

            proc.on('error', (err: Error) => {
                clearTimeout(timer);
                resolve({ passed: false, ruleName: rule.name, errorMessage: err.message });
            });
        });
    }
}
