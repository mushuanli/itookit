import { LLMDriver } from '../src/driver';
import { LLM_PROVIDER_DEFAULTS } from '../src/constants';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runTest() {
    console.log("🚀 Starting Connection Verification...\n");

    const tests = [
        {
            name: 'OpenAI (GPT-4o-mini)',
            config: {
                provider: 'openai',
                apiKey: process.env.OPENAI_API_KEY,
                model: 'gpt-4o-mini'
            },
            thinking: false
        },
        {
            name: 'Anthropic (Claude 3.5 Sonnet)',
            config: {
                provider: 'anthropic',
                apiKey: process.env.ANTHROPIC_API_KEY,
                model: 'claude-3-5-sonnet-20241022'
            },
            thinking: true, // Test thinking parameter
            thinkingBudget: 1024
        },
        {
            name: 'Gemini (1.5 Flash)',
            config: {
                provider: 'gemini',
                apiKey: process.env.GEMINI_API_KEY,
                model: 'gemini-1.5-flash'
            },
            thinking: false
        }
    ];

    for (const test of tests) {
        if (!test.config.apiKey) {
            console.log(`⚠️  Skipping ${test.name}: No API Key found.`);
            continue;
        }

        console.log(`Testing ${test.name}...`);
        try {
            const driver = new LLMDriver(test.config as any);
            
            // 1. Test Regular Request
            const start = Date.now();
            const response = await driver.chat.create({
                messages: [{ role: 'user', content: 'What is 2+2? Answer in one word.' }],
                thinking: test.thinking,
                thinkingBudget: test.thinkingBudget
            });
            const duration = Date.now() - start;

            const content = response.choices[0].message.content;
            const thinking = response.choices[0].message.thinking;

            console.log(`   ✅ Status: OK (${duration}ms)`);
            console.log(`   📝 Output: ${content}`);
            if (thinking) {
                console.log(`   🧠 Thinking: ${thinking.substring(0, 50)}...`);
            }

            // 2. Test Stream Request
            process.stdout.write(`   🌊 Streaming: `);
            const stream = await driver.chat.create({
                messages: [{ role: 'user', content: 'Count to 3.' }],
                stream: true,
                thinking: test.thinking,
                thinkingBudget: test.thinkingBudget
            });

            let streamedContent = '';
            for await (const chunk of stream) {
                const delta = chunk.choices[0].delta.content || '';
                streamedContent += delta;
                process.stdout.write('.');
            }
            console.log(streamedContent.length > 0 ? ' Done' : ' Failed');
            
        } catch (error: any) {
            console.error(`   ❌ Failed: ${error.message}`);
            if (error.requestBody) {
                console.error(`      Debug:`, JSON.stringify(error.requestBody, null, 2));
            }
        }
        console.log('-----------------------------------');
    }
}

runTest();
