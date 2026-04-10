// @file: llm-harness/src/executor/back-pressure.ts
// 反压验证器实现。

import { spawn } from 'node:child_process';
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
        return new Promise((resolve) => {
            const chunks: string[] = [];
            const proc = spawn('sh', ['-c', rule.command], {
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
