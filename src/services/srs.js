// src/services/srs.js (NEW FILE)

// --- 配置常量 ---
const AGAIN_INTERVAL = 10 * 60 * 1000; // 10分钟，单位毫秒
const INITIAL_EASE_FACTOR = 2.5; // Anki 默认简易度 250%

/**
 * 计算下一次待办的状态
 * @param {object} currentState - 当前的待办状态 { interval, easeFactor, state }
 * @param {number} rating - 用户评分 (0: Again, 1: Hard, 2: Good, 3: Easy)
 * @returns {object} - 更新后的状态 { due, interval, easeFactor, state }
 */
export function calculateNextReview(currentState, rating) {
    const now = Date.now();
    let { interval = 0, easeFactor = INITIAL_EASE_FACTOR, state = 'new' } = currentState;

    if (state === 'new' || state === 'learning') {
        // 对于新卡片或学习中的卡片
        switch (rating) {
            case 0: // Again
                // 保持在学习阶段，10分钟后重试
                return { due: now + AGAIN_INTERVAL, interval: 0, easeFactor, state: 'learning' };
            case 1: // Hard
                return { due: now + 1 * 24 * 3600 * 1000, interval: 1, easeFactor, state: 'review' };
            case 2: // Good
                return { due: now + 3 * 24 * 3600 * 1000, interval: 3, easeFactor, state: 'review' };
            case 3: // Easy
                return { due: now + 5 * 24 * 3600 * 1000, interval: 5, easeFactor, state: 'review' };
        }
    }

    // 对于正在待办的卡片 (state === 'review')
    switch (rating) {
        case 0: // Again (Lapse)
            easeFactor = Math.max(1.3, easeFactor - 0.2);
            // 进入学习阶段，10分钟后重试
            return { due: now + AGAIN_INTERVAL, interval: 0, easeFactor, state: 'learning' };
        case 1: // Hard
            interval = Math.max(1, interval * 1.2);
            easeFactor = Math.max(1.3, easeFactor - 0.15);
            break;
        case 2: // Good
            // interval 不变，直接乘以 easeFactor
            break;
        case 3: // Easy
            easeFactor += 0.15;
            break;
    }

    const nextIntervalInDays = Math.max(interval + 1, interval * easeFactor);
    const nextDueDate = now + nextIntervalInDays * 24 * 3600 * 1000;

    return {
        due: nextDueDate,
        interval: nextIntervalInDays,
        easeFactor,
        state: 'review'
    };
}