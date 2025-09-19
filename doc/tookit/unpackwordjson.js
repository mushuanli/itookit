const fs = require('fs');
const path = require('path');

// --- 脚本核心逻辑 ---

/**
 * 主函数
 */
function main() {
  // 1. 获取命令行参数
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('错误: 请提供两个参数！');
    console.log('用法: node process_words.js <json文件名> <unit号>');
    return;
  }

  const inputJsonFile = args[0];
  const newUnitNumber = parseInt(args[1], 10);

  if (isNaN(newUnitNumber)) {
    console.error(`错误: unit号 "${args[1]}" 不是一个有效的数字。`);
    return;
  }

  // 2. 检查并读取源JSON文件
  if (!fs.existsSync(inputJsonFile)) {
    console.error(`错误: 输入文件 "${inputJsonFile}" 不存在。`);
    return;
  }

  let sourceData;
  try {
    const fileContent = fs.readFileSync(inputJsonFile, 'utf8');
    sourceData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`错误: 解析JSON文件 "${inputJsonFile}" 失败:`, err);
    return;
  }

  if (!Array.isArray(sourceData)) {
      console.error(`错误: JSON文件 "${inputJsonFile}" 的顶层结构必须是一个数组。`);
      return;
  }

  // 3. 准备输出目录和索引数组
  const outputDir = 'word_json';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
    console.log(`目录 "${outputDir}" 已创建。`);
  }

  const newIndexEntries = [{"name": `${newUnitNumber}`},];

  // 4. 遍历数据并处理每个单词
  console.log(`开始处理文件 "${inputJsonFile}" 中的 ${sourceData.length} 个单词...`);
  for (const word of sourceData) {
    if (!word.name) {
        console.warn('警告: 发现一个没有 "name" 属性的条目，已跳过。', word);
        continue;
    }
    
    console.log(`正在处理: ${word.name}`);

    // --- 任务1: 创建独立的单词JSON文件 ---
    const { audio, audio_example, image, ...wordData } = word;
    wordData.unit = newUnitNumber; // 修改unit号

    const outputFilePath = path.join(outputDir, `${word.name}.json`);
    try {
      // 使用null, 2进行格式化输出，使其更易读
      fs.writeFileSync(outputFilePath, JSON.stringify(wordData, null, 2), 'utf8');
      console.log(`  -> 已保存到 ${outputFilePath}`);
    } catch (err) {
      console.error(`  -> 错误: 无法写入文件 ${outputFilePath}`, err);
    }

    // --- 任务2: 准备要追加到index.json的数据 ---
    const indexEntry = {
      name: word.name,
      symbol: word.symbol,
      chn: word.chn,
    };
    newIndexEntries.push(indexEntry);
  }
  
  // 5. 更新index.json
  updateIndexFile(newIndexEntries);

  console.log('\n处理完成！');
}

/**
 * 读取现有的 index.json，追加新内容，然后写回。
 * @param {Array<object>} newEntries - 要追加的新索引条目数组。
 */
function updateIndexFile(newEntries) {
  const indexFilePath = 'index.json';
  let existingIndexData = [];

  // 尝试读取现有文件
  try {
    if (fs.existsSync(indexFilePath)) {
      const fileContent = fs.readFileSync(indexFilePath, 'utf8');
      if (fileContent) { // 确保文件不是空的
        existingIndexData = JSON.parse(fileContent);
        if (!Array.isArray(existingIndexData)) {
             console.warn(`警告: "${indexFilePath}" 内容不是一个数组，将重置为空数组。`);
             existingIndexData = [];
        }
      }
    }
  } catch (err) {
    console.error(`错误: 读取或解析 "${indexFilePath}" 失败，将创建一个新文件。`, err);
    existingIndexData = []; // 如果解析失败，则从空数组开始
  }

  // 合并新旧数据
  const combinedData = existingIndexData.concat(newEntries);

  // 写回文件
  try {
    fs.writeFileSync(indexFilePath, JSON.stringify(combinedData, null, 2), 'utf8');
    console.log(`索引文件 "${indexFilePath}" 已成功更新，新增了 ${newEntries.length} 个条目。`);
  } catch (err) {
    console.error(`错误: 写入 "${indexFilePath}" 失败。`, err);
  }
}

// --- 运行脚本 ---
main();