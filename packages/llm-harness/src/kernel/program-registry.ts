import type { ProcessProgram } from '@itookit/common';

export class ProcessProgramRegistry {
    private readonly programs = new Map<string, ProcessProgram>();

    register(program: ProcessProgram): void {
        if (this.programs.has(program.kind)) {
            throw new Error(`Process program already registered: ${program.kind}`);
        }
        this.programs.set(program.kind, program);
    }

    has(kind: string): boolean {
        return this.programs.has(kind);
    }

    resolve(kind: string): ProcessProgram {
        const program = this.programs.get(kind);
        if (!program) throw new Error(`Process program is not registered: ${kind}`);
        return program;
    }

    list(): string[] {
        return [...this.programs.keys()];
    }
}
