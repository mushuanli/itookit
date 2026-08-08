// @file: llm-harness/src/factory.ts
// Assembly factory for the process kernel and injected resource ports.

import type {
    IToolService,
    ISkillService,
    ILLMService,
    ITTYDriver,
    VfsPort,
} from '@itookit/common';
import type {
    IDeviceDriver,
} from '@itookit/stdio';
import { LLMServiceAdapter } from './adapters/llm-service-adapter';
import { ToolDeviceDriver, BUILTIN_TOOLS } from '@itookit/tools';
import { TTYSessionManager } from '@itookit/device-tty';
import { SkillDeviceDriver } from './drivers/skill-device-driver';
import { HarnessKernel } from './kernel/harness-kernel';
import { DagPluginRegistry } from './plugins/dag-plugin-registry';
import { DagScheduler } from './scheduling/dag/dag-scheduler';
import {
    createLoadSkillHandler,
    loadSkillDefinition,
    loadSkillMeta,
} from './tools/load-skill';
import { humanInputDefinition, humanInputMeta } from './tools/human-input';
import {
    createShellSessionHandler,
    shellSessionDefinition,
    shellSessionMeta,
} from './tools/shell-session';
import {
    createTtyCloseHandler,
    ttyCloseDefinition,
    ttyCloseMeta,
} from './tools/tty-close';
import {
    createTtyWriteHandler,
    ttyWriteDefinition,
    ttyWriteMeta,
} from './tools/tty-write';
import {
    builtinDagPrograms,
    registerBuiltinDagPlugins,
} from './plugins/builtin';

export interface HarnessOptions {
    /**
     * An initialised LLM device driver instance (LLMDeviceDriver from @itookit/device-llm).
     * Obtain via the VFS device manager: `vfsManager.getDevice('llm')`.
     */
    llmDriver: IDeviceDriver;

    /**
     * Optional TTY driver for interactive shell sessions.
     *
     * When provided, the harness registers shell_session, tty_write, and tty_close tools,
     * enabling persistent shell sessions with bidirectional I/O.
     *
     * @example
     * ```ts
     * import { NodeTTYDriver } from '@itookit/device-tty';
     * const harness = await createHarness({ llmDriver, ttyDriver: new NodeTTYDriver() });
     * ```
     */
    ttyDriver?: ITTYDriver;
    /** Optional VFS resource port exposed to ProcessProgram instances. */
    vfsPort?: VfsPort;
    /** Maximum number of cooperatively scheduled processes. */
    maxConcurrentProcesses?: number;
}

export interface HarnessInstance {
    /** Tool service (register additional tools) */
    toolService: IToolService;
    /** Skill service (register / load Skills) */
    skillService: ISkillService;
    /**
     * One-shot LLM service (chat against any connectionId, no session).
     * Used for utility calls such as image OCR via the vision connection.
     */
    llmService: ILLMService;
    /** Tool device driver (mountable at VFS /dev/tools) */
    toolDriver: ToolDeviceDriver;
    /** Skill device driver (mountable at VFS /dev/skills) */
    skillDriver: SkillDeviceDriver;
    /** Process lifecycle, scheduling, checkpoint and attach control plane. */
    kernel: HarnessKernel;
    /** Versioned DAG manifest/runtime/UI contribution registry. */
    dagPlugins: DagPluginRegistry;
}

/**
 * Create a fully-wired Agent Harness instance.
 *
 * @example
 * ```typescript
 * const llmDriver = vfsManager.getDevice('llm');
 * const harness = await createHarness({ llmDriver });
 * const handle = await harness.kernel.submit({ scheduler: 'direct', spec });
 * ```
 */
export async function createHarness(options: HarnessOptions): Promise<HarnessInstance> {
    const llmService = new LLMServiceAdapter(options.llmDriver, 'harness');
    const toolDriver = new ToolDeviceDriver(BUILTIN_TOOLS);
    const skillDriver = new SkillDeviceDriver();
    registerProcessTools(toolDriver, skillDriver.getService(), options.ttyDriver);
    await toolDriver.init();
    const dagPlugins = new DagPluginRegistry();
    const kernel = createKernel(options, llmService, toolDriver, dagPlugins);

    return {
        toolService: toolDriver.getService(),
        skillService: skillDriver.getService(),
        llmService,
        toolDriver,
        skillDriver,
        kernel,
        dagPlugins,
    };
}

function createKernel(
    options: HarnessOptions,
    llm: ILLMService,
    tools: ToolDeviceDriver,
    plugins: DagPluginRegistry,
): HarnessKernel {
    const kernel = new HarnessKernel({
        resources: {
            llm,
            tools: tools.getService(),
            vfs: options.vfsPort ?? createUnavailableVfsPort(),
        },
        maxConcurrent: options.maxConcurrentProcesses,
    });
    for (const program of builtinDagPrograms()) kernel.registerProgram(program);
    registerBuiltinDagPlugins(plugins);
    kernel.registerScheduler(new DagScheduler(plugins));
    return kernel;
}

function registerProcessTools(
    tools: ToolDeviceDriver,
    skills: ISkillService,
    tty?: ITTYDriver,
): void {
    tools.registerTool(loadSkillMeta, loadSkillDefinition, createLoadSkillHandler(skills));
    tools.registerTool(humanInputMeta, humanInputDefinition, async () => {
        throw new Error('human_input must be handled by AgentProgram as a wait condition');
    });
    if (tty) registerTtyTools(tools, tty);
}

function registerTtyTools(tools: ToolDeviceDriver, tty: ITTYDriver): void {
    const sessions = new TTYSessionManager();
    tools.registerTool(
        shellSessionMeta,
        shellSessionDefinition,
        createShellSessionHandler(tty, sessions),
    );
    tools.registerTool(ttyWriteMeta, ttyWriteDefinition, createTtyWriteHandler(sessions));
    tools.registerTool(ttyCloseMeta, ttyCloseDefinition, createTtyCloseHandler(sessions));
}

function createUnavailableVfsPort(): VfsPort {
    const unavailable = async (): Promise<never> => {
        throw new Error('VFS resource port is not configured');
    };
    return {
        readFile: unavailable,
        writeFile: unavailable,
        listFiles: unavailable,
    };
}
