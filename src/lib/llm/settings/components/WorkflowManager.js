/**
 * 文件: #llm/settings/components/WorkflowManager.js
 * @description UI component for managing and composing workflows.
 * @change
 * - REFACTORED: The component now manages a workflow's own `interface` (inputs/outputs).
 * - REFACTORED: The layout is now a three-pane view with a dedicated properties/interface panel.
 * - REFACTORED: `registerNodeTypes` now registers other workflows as composable nodes, in addition to agents.
 * - REFACTORED: Automatically manages special `graph/input` and `graph/output` nodes on the canvas, linked to the defined interface.
 * - FIXED: Moved the "Save" button to the central toolbar to ensure it's always visible.
 */

export class WorkflowManager {
    /**
     * @param {HTMLElement} element
     * @param {object} options
     * @param {object[]} options.initialWorkflows
     * @param {object} options.initialRunnables
     * @param {Function} options.onRun
     * @param {Function} options.onSave - [核心修改] 保存 workflow 的回调
     * @param {Function} options.onNotify
     */
    constructor(element, { initialWorkflows, initialRunnables, onRun, onSave, onNotify }) {
        if (typeof LiteGraph === 'undefined') throw new Error('LiteGraph.js is not loaded.');
        
        this.element = element;
        this.workflows = initialWorkflows;
        this.runnables = initialRunnables; // { agents: [], workflows: [] }
        this.onNotify = onNotify || ((message, type) => alert(`${type}: ${message}`));
        this.onRun = onRun;
        
        // [核心修改] 保存回调函数
        this.onSave = onSave;

        this.selectedWorkflowId = null;
        this.isDirty = false;

        this.renderLayout();

        this.ui = {
            listPane: this.element.querySelector('.list-pane'),
            propsPane: this.element.querySelector('.workflow-props-pane'),
            canvas: this.element.querySelector('#workflow-canvas'),
        };
        
        this.graph = new LiteGraph.LGraph();
        this.graphCanvas = new LiteGraph.LGraphCanvas(this.ui.canvas, this.graph);
        this.graph.onGraphChanged = () => { this.isDirty = true; };

        this.adjustCanvasSize();
        this.registerNodeTypes();
        this.renderWorkflowList();
        this.attachEventListeners();
        
        // Load the first workflow by default if it exists
        if (this.workflows.length > 0) {
            this.loadWorkflow(this.workflows[0].id);
        } else {
            this.renderPropsPane(null); // Render empty props pane
        }
    }

    renderLayout() {
        this.element.innerHTML = `
            <div class="split-view" style="gap: 0;">
                <div class="list-pane" style="width: 250px;"></div>
                <div class="detail-pane" style="display: flex; flex-direction: column; border-right: 1px solid var(--settings-border); border-left: 1px solid var(--settings-border);">
                    <div class="workflow-toolbar">
                        <span style="font-weight: bold; padding: 0 10px;">Canvas</span>
                        <div style="margin-left: auto; display: flex; gap: 10px;">
                            <!-- --- FIXED: Moved Save button here for consistent visibility --- -->
                            <button id="save-workflow-btn" class="settings-btn">Save</button>
                            <button id="run-workflow-btn" class="settings-btn">Run</button>
                        </div>
                    </div>
                    <div class="workflow-canvas-container">
                        <canvas id="workflow-canvas"></canvas>
                    </div>
                </div>
                <div class="workflow-props-pane" style="width: 350px;"></div>
            </div>
        `;
    }

    renderWorkflowList() {
        const listHtml = (this.workflows || []).map(wf => `
            <div class="list-item ${wf.id === this.selectedWorkflowId ? 'selected' : ''}" data-id="${wf.id}">
                <strong>${wf.name}</strong>
            </div>
        `).join('');
        this.ui.listPane.innerHTML = `<h3>Workflows</h3>` + listHtml + `<br/><button id="new-workflow-btn" class="settings-btn">New Workflow</button>`;
    }

    renderPropsPane(workflow) {
        if (!workflow) {
            this.ui.propsPane.innerHTML = `<div class="detail-pane"><p>Select or create a workflow.</p></div>`;
            return;
        }

        const createInterfaceRows = (items = []) => items.map(item => `
            <div class="interface-row">
                <input type="text" value="${item.name}" placeholder="Name">
                <select>
                    ${['string', 'number', 'boolean', 'object'].map(t => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                <input type="text" value="${item.description || ''}" placeholder="Description">
                <button type="button" class="remove-row-btn">&times;</button>
            </div>
        `).join('');

        this.ui.propsPane.innerHTML = `
            <div class="detail-pane">
                <h3>Properties</h3>
                <div class="form-group">
                    <label>Workflow Name</label>
                    <input type="text" id="workflow-name-input" value="${workflow.name}" placeholder="Workflow Name"/>
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="workflow-description-input" rows="3">${workflow.description || ''}</textarea>
                </div>
                
                <hr style="margin: 20px 0;"/>

                <h3>Interface</h3>
                <div class="interface-editor">
                    <h4>Inputs <button type="button" class="add-interface-btn" data-type="inputs">+</button></h4>
                    <div id="inputs-list">${createInterfaceRows(workflow.interface?.inputs)}</div>
                    <h4>Outputs <button type="button" class="add-interface-btn" data-type="outputs">+</button></h4>
                    <div id="outputs-list">${createInterfaceRows(workflow.interface?.outputs)}</div>
                </div>

            </div>
        `;
    }
    
    _findOrCreateInterfaceNode(type, title, pos) {
        let node = this.graph.findNodesByType(type)[0];
        if (!node) {
            node = LiteGraph.createNode(type);
            node.title = title;
            node.pos = pos;
            node.removable = false; // Prevent user from deleting these special nodes
            this.graph.add(node);
        }
        return node;
    }

    _syncInterfaceWithGraph() {
        const inputNode = this._findOrCreateInterfaceNode("graph/input", "Workflow Inputs", [100, 200]);
        const outputNode = this._findOrCreateInterfaceNode("graph/output", "Workflow Outputs", [800, 200]);

        const currentInputNames = new Set(inputNode.outputs.map(o => o.name));
        const currentOutputNames = new Set(outputNode.inputs.map(i => i.name));

        const desiredInputNames = new Set();
        const desiredOutputNames = new Set();

        this.element.querySelectorAll('#inputs-list .interface-row').forEach(row => {
            const name = row.children[0].value.trim();
            const type = row.children[1].value;
            if (name) {
                desiredInputNames.add(name);
                if (!currentInputNames.has(name)) inputNode.addOutput(name, type);
            }
        });

        // Sync outputs from UI to graph/output node inputs
        this.element.querySelectorAll('#outputs-list .interface-row').forEach(row => {
            const name = row.children[0].value.trim();
            const type = row.children[1].value;
            if (name) {
                desiredOutputNames.add(name);
                if (!currentOutputNames.has(name)) outputNode.addInput(name, type);
            }
        });

        for (let i = inputNode.outputs.length - 1; i >= 0; i--) {
            if (!desiredInputNames.has(inputNode.outputs[i].name)) inputNode.removeOutput(i);
        }
        for (let i = outputNode.inputs.length - 1; i >= 0; i--) {
            if (!desiredOutputNames.has(outputNode.inputs[i].name)) outputNode.removeInput(i);
        }

        this.graph.setDirtyCanvas(true, true);
    }


    loadWorkflow(workflowId) {
        if (this.isDirty && !confirm("You have unsaved changes. Are you sure you want to discard them?")) return;

        this.selectedWorkflowId = workflowId;
        const workflow = this.workflows.find(wf => wf.id === workflowId);
        
        this.graph.clear();
        if (workflow) {
            // Ensure interface is an object before loading
            const graphData = { ...workflow, interface: workflow.interface || { inputs: [], outputs: [] } };
            this.graph.configure(graphData);
            this.renderPropsPane(graphData);
        } else {
            const newWorkflow = { id: null, name: 'New Workflow', description: '', interface: { inputs: [], outputs: [] } };
            this.renderPropsPane(newWorkflow);
        }
        
        this._syncInterfaceWithGraph(); // Ensure interface nodes exist
        this.isDirty = false;
        this.renderWorkflowList();
        this.updateRunnables({ // Re-register nodes to exclude the currently selected workflow
            ...this.runnables 
        });
    }

    saveCurrentWorkflow() {
        const nameInput = this.element.querySelector('#workflow-name-input');
        if (!nameInput) return; // Not editing any workflow

        const name = nameInput.value.trim();
        if (!name) {
            this.onNotify('Please provide a name for the workflow.', 'error');
            return;
        }

        const graphData = this.graph.serialize();
        
        // Collect interface from the properties pane
        const getInterface = (type) => Array.from(this.element.querySelectorAll(`#${type}-list .interface-row`)).map(row => ({
            name: row.children[0].value.trim(),
            type: row.children[1].value,
            description: row.children[2].value.trim()
        })).filter(item => item.name);

        const workflowInterface = { inputs: getInterface('inputs'), outputs: getInterface('outputs') };
        
        let workflow = {
            ...graphData,
            name,
            description: this.element.querySelector('#workflow-description-input').value,
            interface: workflowInterface
        };
        
        const existingIndex = this.workflows.findIndex(wf => wf.id === this.selectedWorkflowId);

        if (existingIndex > -1) {
            workflow.id = this.selectedWorkflowId;
            this.workflows[existingIndex] = workflow;
        } else {
            workflow.id = `wf-${Date.now()}`;
            this.workflows.push(workflow);
            this.selectedWorkflowId = workflow.id;
        }
        
        // [核心修改] 调用注入的回调函数 (最终会调用 llmService.saveWorkflows)
        if (this.onSave) {
            this.onSave(this.workflows);
        } else {
            console.error("WorkflowManager: onSave 回调未提供。");
        }

        this.isDirty = false;
        this.renderWorkflowList();
        this.onNotify('Workflow saved!', 'success');
    }

    attachEventListeners() {
        this.element.addEventListener('click', e => {
            const listItem = e.target.closest('.list-item');
            if (listItem) { this.loadWorkflow(listItem.dataset.id); return; }
            if (e.target.id === 'new-workflow-btn') { this.loadWorkflow(null); return; }
            if (e.target.id === 'save-workflow-btn') { this.saveCurrentWorkflow(); return; }
            if (e.target.id === 'run-workflow-btn') {
                 const currentWorkflow = this.graph.serialize();
                 currentWorkflow.name = this.element.querySelector('#workflow-name-input').value || "Untitled Run";
                 this.onRun(currentWorkflow);
                 return;
            }

            // Handle interface editor buttons
            const addBtn = e.target.closest('.add-interface-btn');
            if (addBtn) {
                const type = addBtn.dataset.type;
                const list = this.element.querySelector(`#${type}-list`);
                const newRow = document.createElement('div');
                newRow.className = 'interface-row';
                newRow.innerHTML = `<input type="text" placeholder="Name"><select><option value="string">string</option><option value="number">number</option></select><input type="text" placeholder="Description"><button type="button" class="remove-row-btn">&times;</button>`;
                list.appendChild(newRow);
                this.isDirty = true;
                return;
            }
            const removeBtn = e.target.closest('.remove-row-btn');
            if (removeBtn) {
                removeBtn.parentElement.remove();
                this._syncInterfaceWithGraph();
                this.isDirty = true;
                return;
            }
        });

        this.element.addEventListener('input', e => {
            const input = e.target.closest('.interface-row input, .interface-row select, #workflow-name-input, #workflow-description-input');
            if (input) {
                this.isDirty = true;
                if (input.closest('.interface-row')) {
                    this._syncInterfaceWithGraph();
                }
            }
        });
    }

    adjustCanvasSize() {
        const container = this.element.querySelector('.workflow-canvas-container');
        if (!container) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                this.graphCanvas.resize(width, height);
            }
        });
        resizeObserver.observe(container);
    }
    
    registerNodeTypes() {
        // Clear existing to prevent duplicates on update
        LiteGraph.registered_node_types = {};
        
        // 1. Register special built-in nodes
        class GraphInputNode { constructor() { this.title = "Workflow Inputs"; } }
        LiteGraph.registerNodeType("graph/input", GraphInputNode);
        class GraphOutputNode { constructor() { this.title = "Workflow Outputs"; } }
        LiteGraph.registerNodeType("graph/output", GraphOutputNode);

        const primitives = {
            'input/text': class { constructor(){ this.addOutput("value", "string"); this.properties = { value: "" }; this.title="Text Input"; }},
            'string/template': class { constructor(){ this.addInput("text", "string"); this.addOutput("output", "string"); this.properties = { template: "{text}" }; this.title="Template"; }},
        };
        Object.entries(primitives).forEach(([name, nodeClass]) => LiteGraph.registerNodeType(name, nodeClass));
        
        // 3. Register Agents as nodes
        (this.runnables.agents || []).forEach(agent => {
            function AgentNode() {
                (agent.interface.inputs || []).forEach(input => this.addInput(input.name, input.type));
                (agent.interface.outputs || []).forEach(output => this.addOutput(output.name, output.type));
                this.title = `${agent.icon || '🤖'} ${agent.name}`;
                this.description = agent.description;
            }
            LiteGraph.registerNodeType(`agent/${agent.id}`, AgentNode);
        });

        // 4. Register OTHER Workflows as nodes
        (this.runnables.workflows || []).forEach(wf => {
            // Prevent a workflow from including itself
            if (wf.id === this.selectedWorkflowId) return;

            function WorkflowNode() {
                (wf.interface.inputs || []).forEach(input => this.addInput(input.name, input.type));
                (wf.interface.outputs || []).forEach(output => this.addOutput(output.name, output.type));
                this.title = `🌀 ${wf.name}`;
                this.description = wf.description;
            }
            LiteGraph.registerNodeType(`workflow/${wf.id}`, WorkflowNode);
        });

        // Redraw canvas to show new node types in the search box
        this.graphCanvas.draw(true);

    }

    updateRunnables(newRunnables) {
        this.runnables = newRunnables;
        this.registerNodeTypes();
    }

    // --- FIX: Added update method for external changes ---
    update({ initialWorkflows }) {
        if (initialWorkflows) {
            this.workflows = initialWorkflows;
            // If the currently selected workflow was deleted externally, clear the details pane.
            if (this.selectedWorkflowId && !this.workflows.some(wf => wf.id === this.selectedWorkflowId)) {
                this.selectedWorkflowId = null;
                this.graph.clear();
                this.renderPropsPane(null);
            }
            this.renderWorkflowList();
        }
    }
}
