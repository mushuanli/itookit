// @file: llm-kernel/src/runtime/state-machine.ts

import { getEventBus } from '../core/event-bus';

/**
 * 状态定义
 */
export interface StateDefinition<TContext = any> {
    /** 进入状态时执行 */
    onEnter?: (context: TContext) => void | Promise<void>;
    
    /** 离开状态时执行 */
    onExit?: (context: TContext) => void | Promise<void>;
    
    /** 状态内可处理的事件 */
    on?: Record<string, string | StateTransition<TContext>>;
}

/**
 * 状态转换
 */
export interface StateTransition<TContext = any> {
    /** 目标状态 */
    target: string;
    
    /** 转换条件 */
    guard?: (context: TContext, event: any) => boolean;
    
    /** 转换时执行的动作 */
    actions?: Array<(context: TContext, event: any) => void | Promise<void>>;
}

/**
 * 状态机配置
 */
export interface StateMachineConfig<TContext = any> {
    /** 唯一标识 */
    id: string;
    
    /** 初始状态 */
    initial: string;
    
    /** 初始上下文 */
    context: TContext;
    
    /** 状态定义 */
    states: Record<string, StateDefinition<TContext>>;
}

/**
 * 状态机
 */
export class StateMachine<TContext = any> {
    private currentState: string;
    private context: TContext;
    private config: StateMachineConfig<TContext>;
    private listeners = new Set<(state: string, context: TContext) => void>();
    
    constructor(config: StateMachineConfig<TContext>) {
        this.config = config;
        this.currentState = config.initial;
        this.context = { ...config.context };
    }
    
    /**
     * 获取当前状态
     */
    getState(): string {
        return this.currentState;
    }
    
    /**
     * 获取当前上下文
     */
    getContext(): TContext {
        return { ...this.context };
    }
    
    /**
     * 发送事件触发状态转换
     */
    async send(eventType: string, payload?: any): Promise<boolean> {
        const stateConfig = this.config.states[this.currentState];
        if (!stateConfig || !stateConfig.on) {
            return false;
        }
        
        const transition = stateConfig.on[eventType];
        if (!transition) {
            return false;
        }
        
        // 解析转换配置
        const transitionConfig: StateTransition<TContext> = 
            typeof transition === 'string' 
                ? { target: transition } 
                : transition;
        
        // 检查守卫条件
        if (transitionConfig.guard) {
            const allowed = transitionConfig.guard(this.context, payload);
            if (!allowed) {
                return false;
            }
        }
        
        // 执行状态转换
        await this.transition(transitionConfig.target, transitionConfig.actions, payload);
        
        return true;
    }
    
    /**
     * 执行状态转换
     */
    private async transition(
        targetState: string,
        actions?: Array<(context: TContext, event: any) => void | Promise<void>>,
        event?: any
    ): Promise<void> {
        const fromState = this.currentState;
        const fromConfig = this.config.states[fromState];
        const toConfig = this.config.states[targetState];
        
        if (!toConfig) {
            throw new Error(`Invalid target state: ${targetState}`);
        }
        
        // 1. 执行离开动作
        if (fromConfig?.onExit) {
            await fromConfig.onExit(this.context);
        }
        
        // 2. 执行转换动作
        if (actions) {
            for (const action of actions) {
                await action(this.context, event);
            }
        }
        
        // 3. 更新状态
        this.currentState = targetState;
        
        // 4. 执行进入动作
        if (toConfig.onEnter) {
            await toConfig.onEnter(this.context);
        }
        
        // 5. 通知监听器
        this.notifyListeners();
        
        // 6. 发送事件总线事件
        const eventBus = getEventBus();
        eventBus.emit({
            type: 'state:changed',
            executionId: this.config.id,
            timestamp: Date.now(),
            payload: {
                from: fromState,
                to: targetState,
                context: this.context
            }
        });
    }
    
    /**
     * 更新上下文
     */
    updateContext(updater: Partial<TContext> | ((ctx: TContext) => Partial<TContext>)): void {
        const updates = typeof updater === 'function' 
            ? updater(this.context) 
            : updater;
        
        this.context = { ...this.context, ...updates };
        this.notifyListeners();
    }
    
    /**
     * 订阅状态变化
     */
    subscribe(listener: (state: string, context: TContext) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    
    /**
     * 通知监听器
     */
    private notifyListeners(): void {
        for (const listener of this.listeners) {
            try {
                listener(this.currentState, this.context);
            } catch (e) {
                console.error('[StateMachine] Listener error:', e);
            }
        }
    }
    
    /**
     * 检查是否处于某个状态
     */
    matches(state: string): boolean {
        return this.currentState === state;
    }
    
    /**
     * 检查是否可以处理某个事件
     */
    can(eventType: string): boolean {
        const stateConfig = this.config.states[this.currentState];
        return Boolean(stateConfig?.on?.[eventType]);
    }
    
    /**
     * 重置状态机
     */
    reset(): void {
        this.currentState = this.config.initial;
        this.context = { ...this.config.context };
        this.notifyListeners();
    }
    
    /**
     * 获取当前状态可处理的事件列表
     */
    getAvailableEvents(): string[] {
        const stateConfig = this.config.states[this.currentState];
        return stateConfig?.on ? Object.keys(stateConfig.on) : [];
    }
}

/**
 * 创建状态机的便捷函数
 */
export function createStateMachine<TContext = any>(
    config: StateMachineConfig<TContext>
): StateMachine<TContext> {
    return new StateMachine(config);
}

/**
 * 执行状态机示例配置
 */
export const executionStateMachineConfig: StateMachineConfig<{
    startTime?: number;
    endTime?: number;
    error?: string;
    retryCount: number;
}> = {
    id: 'execution',
    initial: 'idle',
    context: {
        retryCount: 0
    },
    states: {
        idle: {
            on: {
                START: 'running'
            },
            onEnter: (ctx) => {
                ctx.startTime = undefined;
                ctx.endTime = undefined;
                ctx.error = undefined;
            }
        },
        running: {
            on: {
                COMPLETE: 'completed',
                ERROR: {
                    target: 'failed',
                    actions: [(ctx, event) => {
                        ctx.error = event.message;
                    }]
                },
                CANCEL: 'cancelled',
                PAUSE: 'paused'
            },
            onEnter: (ctx) => {
                ctx.startTime = Date.now();
            }
        },
        paused: {
            on: {
                RESUME: 'running',
                CANCEL: 'cancelled'
            }
        },
        completed: {
            on: {
                RESET: 'idle'
            },
            onEnter: (ctx) => {
                ctx.endTime = Date.now();
            }
        },
        failed: {
            on: {
                RETRY: {
                    target: 'running',
                    guard: (ctx) => ctx.retryCount < 3,
                    actions: [(ctx) => {
                        ctx.retryCount++;
                    }]
                },
                RESET: 'idle'
            },
            onEnter: (ctx) => {
                ctx.endTime = Date.now();
            }
        },
        cancelled: {
            on: {
                RESET: 'idle'
            },
            onEnter: (ctx) => {
                ctx.endTime = Date.now();
            }
        }
    }
};
