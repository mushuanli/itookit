// @file: llm-kernel/src/orchestrators/dag.ts

import { BaseOrchestrator } from './base-orchestrator';
import { OrchestratorConfig, IExecutor, DAGEdge } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult } from '../core/types';

/**
 * DAG 节点状态
 */
type DAGNodeState = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * DAG 节点运行时信息
 */
interface DAGNodeRuntime {
    executor: IExecutor;
    state: DAGNodeState;
    dependencies: string[];
    dependents: string[];
    result?: ExecutionResult;
}

/**
 * DAG 编排器
 * 按照有向无环图拓扑执行子节点
 */
export class DAGOrchestrator extends BaseOrchestrator {
    private edges: DAGEdge[];
    private maxConcurrency: number;
    
    constructor(
        id: string,
        name: string,
        config: OrchestratorConfig,
        factory: any
    ) {
        super(id, name, config, factory);
        this.edges = config.modeConfig?.dag?.edges || [];
        this.maxConcurrency = config.modeConfig?.parallel?.maxConcurrency || 5;
    }
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        context.events.emit('node:start', {
            executorId: this.id,
            mode: 'dag',
            nodeCount: this.children.length,
            edgeCount: this.edges.length
        });
        
        // 1. 构建 DAG 运行时图
        const nodeMap = this.buildNodeMap();
        
        // 2. 验证 DAG（检测环）
        if (this.hasCycle(nodeMap)) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: 'DAG contains cycles' },
                errors: [{
                    code: 'INVALID_DAG',
                    message: 'DAG contains cycles',
                    recoverable: false
                }]
            };
        }
        
        // 3. 初始化输入节点
        const startNodes = this.findStartNodes(nodeMap);
        for (const nodeId of startNodes) {
            context.variables.set(`_input_${nodeId}`, input);
        }
        
        // 4. 执行 DAG
        try {
            await this.executeDAG(nodeMap, context);
        } catch (error: any) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: 'DAG_EXECUTION_ERROR',
                    message: error.message,
                    recoverable: false
                }]
            };
        }
        
        // 5. 收集结果
        const endNodes = this.findEndNodes(nodeMap);
        const outputs = endNodes.map(nodeId => nodeMap.get(nodeId)?.result?.output);
        
        const hasFailure = Array.from(nodeMap.values()).some(n => n.state === 'failed');
        
        return {
            status: hasFailure ? 'partial' : 'success',
            output: outputs.length === 1 ? outputs[0] : outputs,
            control: { action: 'continue' },
            metadata: {
                executorId: this.id,
                executorType: this.type,
                startTime: Date.now(),
                completedNodes: Array.from(nodeMap.values()).filter(n => n.state === 'completed').length,
                failedNodes: Array.from(nodeMap.values()).filter(n => n.state === 'failed').length
            }
        };
    }
    
    /**
     * 构建节点映射
     */
    private buildNodeMap(): Map<string, DAGNodeRuntime> {
        const nodeMap = new Map<string, DAGNodeRuntime>();
        
        // 初始化所有节点
        for (const child of this.children) {
            nodeMap.set(child.id, {
                executor: child,
                state: 'pending',
                dependencies: [],
                dependents: [],
                result: undefined
            });
        }
        
        // 构建依赖关系
        for (const edge of this.edges) {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            
            if (fromNode && toNode) {
                fromNode.dependents.push(edge.to);
                toNode.dependencies.push(edge.from);
            }
        }
        
        // 标记就绪节点（无依赖的节点）
        for (const [_id, node] of nodeMap) {
            if (node.dependencies.length === 0) {
                node.state = 'ready';
            }
        }
        
        return nodeMap;
    }
    
    /**
     * 检测环
     */
    private hasCycle(nodeMap: Map<string, DAGNodeRuntime>): boolean {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        
        const dfs = (nodeId: string): boolean => {
            visited.add(nodeId);
            recursionStack.add(nodeId);
            
            const node = nodeMap.get(nodeId);
            if (!node) return false;
            
            for (const dependentId of node.dependents) {
                if (!visited.has(dependentId)) {
                    if (dfs(dependentId)) return true;
                } else if (recursionStack.has(dependentId)) {
                    return true;
                }
            }
            
            recursionStack.delete(nodeId);
            return false;
        };
        
        for (const nodeId of nodeMap.keys()) {
            if (!visited.has(nodeId)) {
                if (dfs(nodeId)) return true;
            }
        }
        
        return false;
    }
    
    /**
     * 查找起始节点（无依赖）
     */
    private findStartNodes(nodeMap: Map<string, DAGNodeRuntime>): string[] {
        return Array.from(nodeMap.entries())
            .filter(([_, node]) => node.dependencies.length === 0)
            .map(([id, _]) => id);
    }
    
    /**
     * 查找结束节点（无后继）
     */
    private findEndNodes(nodeMap: Map<string, DAGNodeRuntime>): string[] {
        return Array.from(nodeMap.entries())
            .filter(([_, node]) => node.dependents.length === 0)
            .map(([id, _]) => id);
    }
    
    /**
     * 执行 DAG
     */
    private async executeDAG(
        nodeMap: Map<string, DAGNodeRuntime>,
        context: IExecutionContext
    ): Promise<void> {
        const running = new Set<string>();
        
        while (true) {
            context.checkCancelled();
            
            // 查找就绪节点
            const readyNodes = Array.from(nodeMap.entries())
                .filter(([id, node]) => 
                    node.state === 'ready' && !running.has(id)
                )
                .map(([id, _]) => id);
            
            // 没有就绪节点且没有运行中的节点，执行完成
            if (readyNodes.length === 0 && running.size === 0) {
                break;
            }
            
            // 启动就绪节点（受并发限制）
            const toStart = readyNodes.slice(0, this.maxConcurrency - running.size);
            
            const promises = toStart.map(async (nodeId) => {
                running.add(nodeId);
                const node = nodeMap.get(nodeId)!;
                node.state = 'running';
                
                try {
                    // 收集依赖节点的输出作为输入
                    const inputs = this.collectInputs(nodeId, nodeMap, context);
                    
                    // 执行节点
                    const result = await this.executeChild(node.executor, inputs, context);
                    
                    node.result = result;
                    node.state = result.status === 'success' ? 'completed' : 'failed';
                    
                    // 存储输出到上下文
                    context.variables.set(`_output_${nodeId}`, result.output);
                    
                    // 更新后继节点状态
                    this.updateDependentStates(nodeId, nodeMap);
                    
                } catch (error: any) {
                    node.state = 'failed';
                    node.result = {
                        status: 'failed',
                        output: null,
                        control: { action: 'end' },
                        errors: [{
                            code: 'NODE_ERROR',
                            message: error.message,
                            recoverable: false
                        }]
                    };
                    
                    // 跳过依赖于此节点的所有后续节点
                    this.skipDependents(nodeId, nodeMap);
                    
                } finally {
                    running.delete(nodeId);
                }
            });
            
            // 等待至少一个任务完成
            if (promises.length > 0) {
                await Promise.race(promises);
            } else if (running.size > 0) {
                // 等待所有运行中的任务
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }
    
    /**
     * 收集节点输入
     */
    private collectInputs(
        nodeId: string,
        nodeMap: Map<string, DAGNodeRuntime>,
        context: IExecutionContext
    ): unknown {
        const node = nodeMap.get(nodeId)!;
        
        if (node.dependencies.length === 0) {
            // 起始节点使用初始输入
            return context.variables.get(`_input_${nodeId}`);
        }
        
        if (node.dependencies.length === 1) {
            // 单一依赖，直接使用其输出
            return context.variables.get(`_output_${node.dependencies[0]}`);
        }
        
        // 多个依赖，合并输出
        const inputs: Record<string, unknown> = {};
        for (const depId of node.dependencies) {
            inputs[depId] = context.variables.get(`_output_${depId}`);
        }
        return inputs;
    }
    
    /**
     * 更新后继节点状态
     */
    private updateDependentStates(
        completedNodeId: string,
        nodeMap: Map<string, DAGNodeRuntime>
    ): void {
        const completedNode = nodeMap.get(completedNodeId)!;
        
        for (const dependentId of completedNode.dependents) {
            const dependent = nodeMap.get(dependentId);
            if (!dependent || dependent.state !== 'pending') continue;
            
            // 检查所有依赖是否完成
            const allDepsCompleted = dependent.dependencies.every(depId => {
                const dep = nodeMap.get(depId);
                return dep?.state === 'completed';
            });
            
            if (allDepsCompleted) {
                dependent.state = 'ready';
            }
        }
    }
    
    /**
     * 跳过依赖于失败节点的后续节点
     */
    private skipDependents(
        failedNodeId: string,
        nodeMap: Map<string, DAGNodeRuntime>
    ): void {
        const toSkip = new Set<string>();
        const queue = [failedNodeId];
        
        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            const node = nodeMap.get(nodeId);
            if (!node) continue;
            
            for (const dependentId of node.dependents) {
                if (!toSkip.has(dependentId)) {
                    toSkip.add(dependentId);
                    queue.push(dependentId);
                }
            }
        }
        
        for (const nodeId of toSkip) {
            const node = nodeMap.get(nodeId);
            if (node && node.state === 'pending') {
                node.state = 'skipped';
            }
        }
    }
}
