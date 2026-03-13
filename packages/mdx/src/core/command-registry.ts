// @mdx/core/command-registry.ts
/**
 * 命令注册表
 * 职责：管理编辑器命令的注册和查询
 */
export class CommandRegistry {
    private commands = new Map<string, Function>();

    register(name: string, fn: Function): void {
        this.commands.set(name, fn);
    }

    get(name: string): Function | undefined {
        return this.commands.get(name);
    }

    getAll(): Map<string, Function> {
        return this.commands;
    }

    has(name: string): boolean {
        return this.commands.has(name);
    }

    clear(): void {
        this.commands.clear();
    }
}
