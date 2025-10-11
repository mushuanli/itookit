/**
 * @file #llm/core/chain.js
 * @description Provides a simple sequential chaining mechanism for LLM calls.
 */

import { LLMClient } from './client.js';

/**
 * A simple prompt template function.
 * @private
 */
function templatize(template, variables) {
    return template.replace(/{(\w+)}/g, (_, key) => {
        if (variables[key] === undefined) {
            throw new Error(`Template variable "${key}" not found in context.`);
        }
        return variables[key];
    });
}

export class LLMChain {
    /**
     * @param {LLMClient} client - An instance of LLMClient to execute steps.
     */
    constructor(client) {
        if (!client || typeof client.chat?.create !== 'function') {
            throw new Error('LLMChain requires a valid instance of LLMClient.');
        }
        this.client = client;
        this.steps = [];
    }

    /**
     * Adds a processing step to the chain.
     * @param {object} stepConfig
     * @param {string} stepConfig.promptTemplate - The prompt template for this step.
     * @param {string[]} stepConfig.inputVariables - Variables from the context to use in the template.
     * @param {string} stepConfig.outputVariable - The key under which to save the LLM output in the context.
     * @param {object} [llmConfig] - Additional parameters for the client.chat.create call (e.g., model, temperature).
     * @returns {LLMChain} - The chain instance for fluent chaining.
     */
    add(stepConfig, llmConfig = {}) {
        const { promptTemplate, inputVariables, outputVariable } = stepConfig;
        if (!promptTemplate || !inputVariables || !outputVariable) {
            throw new Error("Step config must include 'promptTemplate', 'inputVariables', and 'outputVariable'.");
        }
        this.steps.push({ ...stepConfig, llmConfig });
        return this;
    }

    /**
     * Executes the chain with an initial context.
     * @param {object} initialContext - The initial key-value pairs for the run.
     * @returns {Promise<object>} - The final context containing inputs and all generated outputs.
     */
    async run(initialContext = {}) {
        let context = { ...initialContext };

        for (const step of this.steps) {
            const promptInput = {};
            step.inputVariables.forEach(key => {
                promptInput[key] = context[key];
            });

            const formattedPrompt = templatize(step.promptTemplate, promptInput);
            
            const response = await this.client.chat.create({
                messages: [{ role: 'user', content: formattedPrompt }],
                ...step.llmConfig
            });

            const result = response.choices[0].message.content;
            context[step.outputVariable] = result;
        }

        return context;
    }
}
