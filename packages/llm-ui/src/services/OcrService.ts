// @file: llm-ui/services/OcrService.ts

import type { ILLMService } from '@itookit/common';

/** Vision connection used for image OCR (image → text). */
const OCR_CONNECTION_ID = 'conn-volcengine-vision';

export class OcrService {
    constructor(private llmService: ILLMService) {}

    /** OCR an image blob to Markdown via vision connection. */
    async ocr(image: Blob): Promise<string> {
        const resp = await this.llmService.chat(OCR_CONNECTION_ID, {
            messages: [{
                role: 'user',
                content: '将图片中的内容忠实转换为 Markdown:保留标题、列表、表格等结构;数学公式用 LaTeX($$ 包裹);只输出内容本身,不要添加任何解释或说明。',
                attachments: [{
                    type: 'image',
                    source: image,
                    mimeType: (image as { type?: string }).type || 'image/jpeg',
                }],
            }],
            maxTokens: 4096,
        });
        return resp.choices?.[0]?.message?.content ?? '';
    }
}
