/**
 * @file #llm/core/workflow-engine.js
 * @description The execution engine for running workflow definitions.
 */

// JSDoc-style imports for type checking
/** @typedef {import('../../config/shared/types.js').LibraryConfig} LibraryConfig */
/** @typedef {import('../../config/shared/types.js').AgentDefinition} AgentDefinition */
/** @typedef {import('../../config/shared/types.js').WorkflowDefinition} WorkflowDefinition */
/** @typedef {import('../../config/shared/types.js').WorkflowNode} WorkflowNode */
/** @typedef {import('../../config/shared/types.js').WorkflowLink} WorkflowLink */

/**
 * @typedef {object} WorkflowEngineOptions
 * @property {LibraryConfig} libraryConfig - The global config containing API keys.
 * @property {AgentDefinition[]} agentDefinitions - A list of all available agents.
 */

// Mock LLMClient for demonstration purposes, as the full core library isn't present.
class MockLLMClient {
    constructor(config) { this.config = config; }
    chat = {
        async create({ messages }) {
            console.log(`[MockLLMClient] Request for model ${this.config.modelName}:`, messages);
            const content = messages.find(m => m.role === 'user')?.content || '';
            // Simulate network delay
            await new Promise(res => setTimeout(res, 300 + Math.random() * 400)); 
            return {
                choices: [{ message: { content: `[Mock Response for ${this.config.modelName}] Processed: "${content}"` } }]
            };
        }
    }
}

/**
 * @typedef {object} WorkflowUpdateEvent
 * @property {'workflow_start' | 'node_start' | 'node_complete' | 'node_error' | 'workflow_complete'} type
 * @property {number} [nodeId] - The ID of the relevant node.
 * @property {any[]} [outputs] - The output data from a completed node.
 * @property {Error} [error] - The error object if a node fails.
 */

export class WorkflowEngine {
    /**
     * Creates an instance of the Workflow Engine.
     * @param {{
     *   libraryConfig: LibraryConfig,
     *   agentDefinitions: AgentDefinition[],
     *   workflowDefinitions: WorkflowDefinition[]
     * }} options
     */
    constructor({ libraryConfig, agentDefinitions, workflowDefinitions }) {
        this.libraryConfig = libraryConfig;
        this.agentDefinitions = new Map(agentDefinitions.map(a => [a.id, a]));
        this.workflowDefinitions = new Map(workflowDefinitions.map(w => [w.id, w]));
        this.llmClientCache = new Map();
    }

    /**
     * Gets a configured LLM client for a specific agent.
     * @param {string} agentId 
     * @returns {MockLLMClient}
     */
    _getClientForAgent(agentId) {
        if (this.llmClientCache.has(agentId)) {
            return this.llmClientCache.get(agentId);
        }

        const agentDef = this.agentDefinitions.get(agentId);
        if (!agentDef) {
            throw new Error(`Agent definition for ID "${agentId}" not found.`);
        }
        
        const conn = this.libraryConfig.connections.find(c => c.id === agentDef.config.connectionId);
        if (!conn) {
            throw new Error(`Connection with ID "${agentDef.config.connectionId}" for agent "${agentDef.name}" not found.`);
        }

        const client = new MockLLMClient({
            apiKey: conn.apiKey,
            baseURL: conn.baseURL,
            modelName: agentDef.config.modelName,
            ...agentDef.config // Include temperature, systemPrompt etc.
        });

        this.llmClientCache.set(agentId, client);
        return client;
    }

    /**
     * Performs a topological sort on the workflow graph to determine execution order.
     * @param {{nodes: WorkflowNode[], links: WorkflowLink[]}} graph
     * @returns {number[]} An array of node IDs in execution order.
     */
    _topologicalSort({ nodes, links }) {
        const inDegree = new Map(nodes.map(node => [node.id, 0]));
        const adj = new Map(nodes.map(node => [node.id, []]));

        for (const link of links) {
            const fromNodeId = link[1];
            const toNodeId = link[3];
            adj.get(fromNodeId)?.push(toNodeId);
            inDegree.set(toNodeId, (inDegree.get(toNodeId) || 0) + 1);
        }

        const queue = nodes.filter(node => inDegree.get(node.id) === 0).map(node => node.id);
        const result = [];

        while (queue.length > 0) {
            const u = queue.shift();
            result.push(u);
            (adj.get(u) || []).forEach(v => {
                inDegree.set(v, inDegree.get(v) - 1);
                if (inDegree.get(v) === 0) {
                    queue.push(v);
                }
            });
        }
        if (result.length !== nodes.length) {
            throw new Error("Workflow has a cycle and cannot be executed.");
        }
        return result;
    }
    
    /**
     * Gathers all input data for a given node from the outputs of its predecessors.
     * @param {WorkflowNode} node The node to gather inputs for.
     * @param {WorkflowLink[]} links All links in the graph.
     * @param {Object<number, any[]>} nodeOutputs A map of already computed node outputs.
     * @returns {any[]} An array of input data, ordered by the target slot index.
     */
    _gatherInputs(node, links, nodeOutputs) {
        const inputs = [];
        const inputLinks = links.filter(link => link[3] === node.id);
        inputLinks.sort((a, b) => a[4] - b[4]); // Sort by target slot index

        for (const link of inputLinks) {
            const fromNodeId = link[1];
            const fromSlotIndex = link[2];
            const sourceOutput = nodeOutputs[fromNodeId];
            if (sourceOutput === undefined) {
                // This should not happen with a correct topological sort unless a node failed
                throw new Error(`Input for node ${node.id} from node ${fromNodeId} is not available.`);
            }
            inputs[link[4]] = sourceOutput[fromSlotIndex];
        }
        return inputs;
    }

    /**
     * Executes a workflow definition.
     * @param {WorkflowDefinition} workflowDefinition - The workflow to run.
     * @param {object} [initialInputs={}] - An object where keys match the workflow's input interface names.
     * @param {(event: any) => void} [onUpdate] - Callback for execution updates.
     * @returns {Promise<Object<string, any>>} A promise that resolves to an object of named outputs.
     */
    async run(workflowDefinition, initialInputs = {}, onUpdate = () => {}) {
        onUpdate({ type: 'workflow_start', workflowId: workflowDefinition.id, name: workflowDefinition.name });

        const nodesById = new Map(workflowDefinition.nodes.map(n => [n.id, n]));
        const executionOrder = this._topologicalSort(workflowDefinition);
        const nodeOutputs = {};

        for (const nodeId of executionOrder) {
            const node = nodesById.get(nodeId);
            if (!node) continue;

            onUpdate({ type: 'node_start', nodeId });

            try {
                const inputs = this._gatherInputs(node, workflowDefinition.links, nodeOutputs);
                let outputs = [];

                if (node.type === 'graph/input') {
                    // Inject the initial data provided to the run method into the graph
                    const workflowInputs = workflowDefinition.interface.inputs || [];
                    outputs = workflowInputs.map(inputDef => initialInputs[inputDef.name]);
                
                } else if (node.type === 'graph/output') {
                    // This is a terminal node; its inputs are gathered but it produces no outputs for other nodes.
                    // The final result will be collected from its inputs after the loop.
                    nodeOutputs[nodeId] = []; // Mark as executed
                    onUpdate({ type: 'node_complete', nodeId, outputs: [] });
                    continue;

                } else if (node.type.startsWith('agent/')) {
                    const agentId = node.type.replace('agent/', '');
                    const client = this._getClientForAgent(agentId);
                    const agentDef = this.agentDefinitions.get(agentId);
                    
                    // Simple mapping: assume first input maps to user message content
                    const userMessage = { role: 'user', content: inputs[0] || "" };
                    const messages = [];
                    if (agentDef.config.systemPrompt) {
                        messages.push({ role: 'system', content: agentDef.config.systemPrompt });
                    }
                    messages.push(userMessage);

                    const response = await client.chat.create({ messages });
                    // Simple mapping: assume first output is the content
                    outputs = [response.choices[0].message.content];

                } else if (node.type.startsWith('workflow/')) {
                    const subWorkflowId = node.type.replace('workflow/', '');
                    const subWorkflowDef = this.workflowDefinitions.get(subWorkflowId);
                    if (!subWorkflowDef) throw new Error(`Sub-workflow definition "${subWorkflowId}" not found.`);
                    
                    const subWorkflowInputs = {};
                    (subWorkflowDef.interface.inputs || []).forEach((inputDef, i) => {
                        subWorkflowInputs[inputDef.name] = inputs[i];
                    });

                    // RECURSIVE CALL to the engine
                    const subWorkflowResult = await this.run(subWorkflowDef, subWorkflowInputs, onUpdate);
                    
                    outputs = (subWorkflowDef.interface.outputs || []).map(outputDef => subWorkflowResult[outputDef.name]);
                
                } else if (node.type === 'input/text') {
                    outputs = [node.properties.value];
                } else if (node.type === 'string/template') {
                    const template = node.properties.template || "{text}";
                    const filled = template.replace(/{text}/g, inputs[0] || '');
                    outputs = [filled];
                } else if (node.type === 'output/display') {
                    console.log(`[Display Node ${node.id}]`, ...inputs);
                    outputs = [...inputs];
                }

                nodeOutputs[nodeId] = outputs;
                onUpdate({ type: 'node_complete', nodeId, outputs });
            } catch (error) {
                console.error(`Error executing node ${nodeId} (${node.type}):`, error);
                onUpdate({ type: 'node_error', nodeId, error });
                throw error;
            }
        }
        
        // After the loop, collect the final named outputs from the graph/output node
        const finalOutputs = {};
        const outputNode = workflowDefinition.nodes.find(n => n.type === 'graph/output');
        if (outputNode) {
            const outputNodeInputs = this._gatherInputs(outputNode, workflowDefinition.links, nodeOutputs);
            (workflowDefinition.interface.outputs || []).forEach((outputDef, i) => {
                finalOutputs[outputDef.name] = outputNodeInputs[i];
            });
        }
        
        onUpdate({ type: 'workflow_complete', workflowId: workflowDefinition.id, outputs: finalOutputs });
        return finalOutputs;
    }

    validate(workflowDefinition) {
        try {
            this._topologicalSort(workflowDefinition);
        } catch (error) {
            return { isValid: false, errors: [error.message] };
        }
        return { isValid: true, errors: [] };
    }
}
