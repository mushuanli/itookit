// generate_md.js

const fs = require('fs');
const path = require('path');

/**
 * 清理单词或词组以用作文件名。
 * - 移除前导星号(*)
 * - 移除结尾的点(.)，以处理像 "sec." 这样的缩写
 * - 保留词组中的空格
 * - 转换为小写
 * @param {string} word - 原始单词或词组
 * @returns {string} - 清理后的文件名
 */
function sanitizeWordForFilename(word) {
    if (!word) return '';
    // 移除前导星号，移除结尾的点，并修剪两端空格
    let cleanWord = word
        .replace(/^\*/, '')      // 例: "*bush fire" -> "bush fire"
        .trim();                 // 清理可能存在的额外空格
    
    // 对于 "as ... as ..." 这样的特殊格式，直接返回，避免它们被错误处理
    // 假设这类特殊格式没有对应的json文件，后续查找会自然跳过
    if (/\s\.\.\.\s/.test(cleanWord)) {
        // 你可以决定如何处理这类特殊词组，这里我们选择不改变它
        // 让它在文件查找时自然失败并给出警告
    }

    return cleanWord.toLowerCase(); // 返回小写版本，如 "bush fire"
}

async function main() {
    // 1. 读取命令行参数
    const inputFile = process.argv[2];
    const detailsDir = process.argv[3];

    if (!inputFile || !detailsDir) {
        console.error("用法: node generate_md.js <主JSON文件> <单词详情JSON目录>");
        console.error("例如: node generate_md.js wordlist.json json/");
        process.exit(1);
    }

    // 2. 读取并解析主JSON文件
    let wordlist;
    try {
        const fileContent = fs.readFileSync(inputFile, 'utf-8');
        wordlist = JSON.parse(fileContent);
    } catch (error) {
        console.error(`错误: 无法读取或解析文件 '${inputFile}'.`, error);
        process.exit(1);
    }
    
    // 用来存储每个单元的Markdown内容
    const unitOutputs = {};
    let currentUnit = null;

    console.log("开始处理词汇表...");

    // 3. 遍历词汇表
    for (const item of wordlist) {
        // 检查是否是单元标记 (e.g., {"name": "1"})
        if (item.chn === undefined && /^\d+$/.test(item.name)) {
            currentUnit = item.name;
            // 如果是新单元，为其准备好Markdown表头
            if (!unitOutputs[currentUnit]) {
                unitOutputs[currentUnit] = `| 中文 | 单词 |\n| :--- | :--- |\n`;
            }
            console.log(`\n--- 切换到 Unit ${currentUnit} ---`);
            continue;
        }

        // 处理单词条目 (必须有 chn 字段并且当前单元已知)
        if (item.chn && currentUnit) {
            const wordName = item.name;
            const sanitizedName = sanitizeWordForFilename(wordName);
            // 如果清理后文件名为空，则跳过
            if (!sanitizedName) continue;

            const detailJsonPath = path.join(detailsDir, `${sanitizedName}.json`);

            let detailData = {};
            // 4. 查找并读取单词详情JSON文件
            if (fs.existsSync(detailJsonPath)) {
                try {
                    const detailContent = fs.readFileSync(detailJsonPath, 'utf-8');
                    detailData = JSON.parse(detailContent);
                    console.log(`  [✓] 找到并处理: ${wordName} (文件: ${sanitizedName}.json)`);
                } catch (err) {
                    console.error(`  [✗] 错误: 处理文件 '${detailJsonPath}' 时出错.`, err);
                    continue; // 跳过这个出错的单词
                }
            } else {
                console.warn(`  [!] 警告: 未找到 '${wordName}' 的详情文件, 已跳过. (查找路径: ${detailJsonPath})`);
                continue; // 跳过这个没有详情的单词
            }

            // 5. 格式化输出行

            // 定义一个辅助函数，用于清理文本：去除首尾空格，并将所有换行符替换为 '¶'
            const clean = (text) => (text || '').trim().replace(/\n/g, '¶');

            // 获取并清理所有可能包含换行符的字段
            const cleanedChn = clean(item.chn);
            const cleanedWordFamily = clean(detailData.word_family || 'N/A');
            const cleanedCollocations = clean(detailData.collocations || 'N/A');
            const cleanedExampleEn = clean(detailData.example_en);
            const cleanedExampleCn = clean(detailData.example_cn);
            
            // 用于音频的单词/词组，移除了星号
            const audioWord = wordName.replace(/^\*/, '').trim();
            // 音频部分的英文例句也需要处理，确保没有换行符
            const audioExampleEn = clean(detailData.example_en);

            // 使用清理后的变量构建Markdown行
            const markdownRow = `| ${cleanedChn} | -- ${wordName} : ${item.symbol || ''} . ¶${cleanedWordFamily}¶${cleanedCollocations}¶${cleanedExampleEn}¶${cleanedExampleCn} --^^audio: ${audioWord} . ${audioExampleEn} ^^|\n`;
            
            // 追加到当前单元的输出中
            unitOutputs[currentUnit] += markdownRow;
        }
    }

    // 6. 将内容写入到各自的 UnitX.md 文件
    console.log("\n--- 开始写入Markdown文件 ---");
    for (const unit in unitOutputs) {
        const outputFilename = `Unit${unit}.md`;
        try {
            fs.writeFileSync(outputFilename, unitOutputs[unit]);
            console.log(`  [✓]成功生成文件: ${outputFilename}`);
        } catch (err) {
            console.error(`  [✗] 错误: 写入文件 '${outputFilename}' 失败.`, err);
        }
    }

    console.log("\n处理完成!");
}

// 运行主函数
main();