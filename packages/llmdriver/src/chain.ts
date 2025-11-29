// @file: llmdriver/chain.ts

import { LLMDriver } from './driver';
import { ChatCompletionParams, ChatCompletionResponse } from './types';

interface ChainStep {
    promptTemplate: string;
    inputVariables: string[];
    outputVariable: string;
    llmConfig?: Partial<ChatCompletionParams>;
}

export class LLMChain {
    // [优化] 将 steps 类型从 any[] 改为 ChainStep[]
    constructor(private client: LLMDriver, private steps: ChainStep[] = []) {}

    add(stepConfig: { promptTemplate: string; inputVariables: string[]; outputVariable: string }, llmConfig: Partial<ChatCompletionParams> = {}): LLMChain {
        this.steps.push({ ...stepConfig, llmConfig });
        return this;
    }

    async run(initialContext: Record<string, any> = {}): Promise<Record<string, any>> {
        let context = { ...initialContext };
        
        for (const step of this.steps) {
            let prompt = step.promptTemplate;
            step.inputVariables.forEach((key: string) => {
                prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), context[key] || '');
            });

            // [修复 1] 显式设置 stream: false。
            // 链式调用通常依赖完整文本进行下一步，不支持流式处理。
            const response = await this.client.chat.create({
                messages: [{ role: 'user', content: prompt }],
                ...step.llmConfig,
                stream: false 
            });

            // [修复 2] 处理类型收窄
            // response 的类型是 ChatCompletionResponse | AsyncGenerator
            if ('choices' in response) {
                // 使用 'as' 断言，明确告知 TS 这是一个 ChatCompletionResponse
                const completion = response as ChatCompletionResponse;
                context[step.outputVariable] = completion.choices[0].message.content;
            }
        }

        return context;
    }
}
