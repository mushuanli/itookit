// @file: llm-harness/src/factory.ts
// Assembly factory — one call to create a fully-wired Agent Harness instance.
//
// Wire-up order:
//   1. Adapt LLM device driver → ILLMService
//   2. Create ToolDeviceDriver (registers builtin tools)
//   3. Create SkillDeviceDriver
//   4. Create AgentDeviceDriver, inject services
//      (AgentDeviceDriver internally creates SubAgentRouter and registers
//       dynamic tools: load_skill + delegate_task)
//   5. Call init() so the driver auto-detects the primary connection + pricing

import type {
    IAgentRuntime,
    IAgentRuntimeConfig,
    IToolService,
    ISkillService,
    ILLMService,
    IDeviceDriver,
    ITTYDriver,
} from '@itookit/common';
import { LLMServiceAdapter } from './adapters/llm-service-adapter';
import { ToolDeviceDriver, BUILTIN_TOOLS } from '@itookit/tools';
import { SkillDeviceDriver } from './drivers/skill-device-driver';
import { AgentDeviceDriver } from './drivers/agent-device-driver';
import { HITLQueue } from './services/hitl-queue';

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
}

export interface HarnessInstance {
    /** Agent runtime (run / abort / on / onIntercept) */
    runtime: IAgentRuntime;
    /** Runtime configuration service (model roles / budget / loop config) */
    config: IAgentRuntimeConfig;
    /** Tool service (register additional tools) */
    toolService: IToolService;
    /** Skill service (register / load Skills) */
    skillService: ISkillService;
    /**
     * One-shot LLM service (chat against any connectionId, no session).
     * Used for utility calls such as image OCR via the vision connection.
     */
    llmService: ILLMService;
    /** Agent device driver (mountable at VFS /dev/agent) */
    agentDriver: AgentDeviceDriver;
    /** Tool device driver (mountable at VFS /dev/tools) */
    toolDriver: ToolDeviceDriver;
    /** Skill device driver (mountable at VFS /dev/skills) */
    skillDriver: SkillDeviceDriver;
}

/**
 * Create a fully-wired Agent Harness instance.
 *
 * @example
 * ```typescript
 * const llmDriver = vfsManager.getDevice('llm');
 * const harness = await createHarness({ llmDriver });
 *
 * harness.runtime.on('agent:tool:start', ({ toolId }) => console.log(`Running: ${toolId}`));
 *
 * const result = await harness.runtime.run({
 *   prompt: 'Refactor the auth module error handling',
 *   workingDirectory: '/workspace/my-project',
 * });
 * ```
 */
export async function createHarness(options: HarnessOptions): Promise<HarnessInstance> {
    const llmService = new LLMServiceAdapter(options.llmDriver, 'harness');
    const toolDriver = new ToolDeviceDriver(BUILTIN_TOOLS);
    const skillDriver = new SkillDeviceDriver();
    const agentDriver = new AgentDeviceDriver();

    // Inject optional TTY driver before setServices so registerDynamicTools
    // can conditionally add shell_session / tty_write / tty_close.
    if (options.ttyDriver) {
        agentDriver.setTTYDriver(options.ttyDriver);
    }

    // Create HITLQueue for human-in-the-loop input requests.
    // The onRequest callback is wired by AgentDeviceDriver.setServices().
    const hitlQueue = new HITLQueue();

    // Inject services. AgentDeviceDriver will:
    //   - create the SubAgentRouter
    //   - register load_skill and delegate_task on toolDriver
    //   - register TTY tools (if ttyDriver was set)
    //   - register human_input tool (when hitlQueue is provided)
    agentDriver.setServices({
        llm: llmService,
        tool: toolDriver.getService(),
        skill: skillDriver.getService(),
        hitlQueue,
    });

    // Auto-detect primary connection + derive per-token pricing.
    // Also initialize tool descriptions (lazy-loaded from Tool.description()).
    await toolDriver.init();
    await agentDriver.init();

    return {
        runtime: agentDriver.getRuntime(),
        config: agentDriver,
        toolService: toolDriver.getService(),
        skillService: skillDriver.getService(),
        llmService,
        agentDriver,
        toolDriver,
        skillDriver,
    };
}
