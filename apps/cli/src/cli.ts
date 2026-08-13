import {
    cancelCommand,
    doctorCommand,
    logsCommand,
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
    switch (parsed.command) {
        case 'validate': return validateCommand(parsed.options);
        case 'run': return runCommand(parsed.options);
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
    const [command, ...rest] = argv;
    const positional: string[] = [];
    const options: CommandOptions = {};
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index];
        if (arg === '-f' || arg === '--file') options.file = required(rest[++index], 'config path');
        else if (arg === '--state-dir') options.stateDir = required(rest[++index], 'state directory');
        else if (arg === '--headless') options.headless = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--follow') options.follow = true;
        else if (arg === '--approve') options.approve = true;
        else if (arg === '--deny') options.deny = true;
        else if (arg === '--value') options.value = required(rest[++index], 'response value');
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
        `  mindos validate [-f mindos.yml]\n` +
        `  mindos run [-f mindos.yml] [--headless] [--json] [--sandbox native|oci]\n` +
        `  mindos runs [--state-dir .mindos]\n` +
        `  mindos status <run-id>\n` +
        `  mindos logs <run-id> [--follow]\n` +
        `  mindos resume <run-id> [--headless] [--json]\n` +
        `  mindos respond <run-id> <request-id> (--approve | --deny | --value <json>)\n` +
        `  mindos cancel <run-id>\n` +
        `  mindos sandbox doctor\n`;
}

main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
}).catch(error => {
    process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
});
