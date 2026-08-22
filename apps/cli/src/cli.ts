import {
    cancelCommand,
    checkpointsCommand,
    deleteCommand,
    doctorCommand,
    forkCommand,
    graphCommand,
    logsCommand,
    promptCommand,
    rerunCommand,
    exportConfigCommand,
    tasksCommand,
    respondCommand,
    resumeCommand,
    runCommand,
    statusCommand,
    validateCommand,
    type CommandOptions,
} from './commands';

interface ParsedArgs {
    command?: string;
    positional: string[];
    options: CommandOptions;
}

async function main(argv: string[]): Promise<number> {
    const parsed = parseArgs(argv);
    // -p / --prompt：直接运行一段 prompt（优先于 command 分发）
    if (parsed.options.prompt) return promptCommand(parsed.options);
    switch (parsed.command) {
        case 'validate': return validateCommand(parsed.options);
        case 'run': return runCommand(parsed.options);
        case 'graph': return graphCommand(parsed.options);
        case 'runs': return statusCommand(undefined, parsed.options);
        case 'status': return statusCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'logs': return logsCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'resume': return resumeCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'respond': return respondCommand(
            required(parsed.positional[0], 'run-id'),
            required(parsed.positional[1], 'request-id'),
            parsed.options,
        );
        case 'cancel': return cancelCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'delete': return deleteCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'checkpoints': return checkpointsCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'tasks': return tasksCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'rerun': return rerunCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'fork': return forkCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'export-config': return exportConfigCommand(required(parsed.positional[0], 'run-id'), parsed.options);
        case 'sandbox':
            if (parsed.positional[0] === 'doctor') return doctorCommand(parsed.options);
            throw new Error('sandbox requires doctor');
        case 'help':
        case undefined:
            process.stdout.write(help());
            return 0;
        default: throw new Error(`Unknown command: ${parsed.command}`);
    }
}

export function parseArgs(argv: string[]): ParsedArgs {
    // 支持 `mindos -p "x"`：参数首位是选项（-p）时无显式 command。
    const isOptionFirst = !argv[0] || argv[0].startsWith('-');
    const command = isOptionFirst ? undefined : argv[0];
    const rest = isOptionFirst ? argv : argv.slice(1);
    const positional: string[] = [];
    const options: CommandOptions = {};
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index];
        if (arg === '-f' || arg === '--file') options.file = required(rest[++index], 'config path');
        else if (arg === '-p' || arg === '--prompt') options.prompt = (options.prompt ? `${options.prompt} ` : '') + required(rest[++index], 'prompt');
        else if (arg === '--model') options.model = required(rest[++index], 'model');
        else if (arg === '--api-key-env') options.apiKeyEnv = required(rest[++index], 'api-key-env');
        else if (arg === '--base-url') options.baseUrl = required(rest[++index], 'base-url');
        else if (arg === '--protocol') options.protocol = required(rest[++index], 'protocol');
        else if (arg === '--responses-path') options.responsesPath = required(rest[++index], 'responses-path');
        else if (arg === '--no-tools') options.noTools = true;
        else if (arg === '--verbose' || arg === '-v') options.verbose = true;
        else if (arg === '--state-dir') options.stateDir = required(rest[++index], 'state directory');
        else if (arg === '--headless') options.headless = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--follow') options.follow = true;
        else if (arg === '--approve') options.approve = true;
        else if (arg === '--deny') options.deny = true;
        else if (arg === '--value') options.value = required(rest[++index], 'response value');
        else if (arg === '--offline') options.offline = true;
        else if (arg === '--sandbox') options.sandbox = sandbox(required(rest[++index], 'sandbox mode'));
        else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
    }
    return { command, positional, options };
}

function sandbox(value: string): 'native' | 'oci' {
    if (value !== 'native' && value !== 'oci') throw new Error(`Invalid sandbox mode: ${value}`);
    return value;
}

function required(value: string | undefined, label: string): string {
    if (!value) throw new Error(`Missing ${label}`);
    return value;
}

function help(): string {
    return `MindOS CLI\n\n` +
        `  mindos validate [-f mindos.yml] [--offline]\n` +
        `  mindos run [-f mindos.yml] [--headless] [--json] [--sandbox native|oci]\n` +
        `  mindos -p "your prompt" [--model provider/model] [--api-key-env ENV] [--base-url URL] [--protocol openai-chat|openai-responses] [--no-tools]\n` +
        `  mindos graph [-f mindos.yml] [--offline]\n` +
        `  mindos runs [--state-dir .mindos]\n` +
        `  mindos status <run-id> [--state-dir .mindos] [--json]\n` +
        `  mindos logs <run-id> [--state-dir .mindos] [--follow]\n` +
        `  mindos resume <run-id> [--state-dir .mindos] [--headless] [--json]\n` +
        `  mindos respond <run-id> <request-id> (--approve | --deny | --value <json>) [--state-dir .mindos]\n` +
        `  mindos cancel <run-id> [--state-dir .mindos]\n` +
        `  mindos delete <run-id> [--state-dir .mindos]\n` +
        `  mindos tasks <run-id> [--state-dir .mindos] [--json]\n` +
        `  mindos rerun <run-id> [--state-dir .mindos] [--headless] [--json]\n` +
        `  mindos export-config <run-id> [--state-dir .mindos]\n` +
        `  mindos sandbox doctor\n\n` +
        `选项：\n` +
        `  --state-dir <dir>   运行状态目录（默认 .mindos，run 时由配置 workspace 决定）\n` +
        `  --headless          无交互模式，事件作为 JSONL 写到 stdout（适合 CI）\n` +
        `  --json              JSON 输出；隐含 --headless（遇到人工输入时返回退出码 3 而非阻塞）\n` +
        `  --offline           校验/查看时不要求 API key 环境变量已存在\n`;
}

main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
}).catch(error => {
    process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
});
