/** UTF-16 offsets match editor positions, including CRLF and non-BMP characters. */
export function lineOffsets(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1);
    return starts;
}

export function lineNumberAt(starts: readonly number[], index: number): number {
    let low = 0, high = starts.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle] <= index) low = middle + 1; else high = middle;
    }
    return Math.max(1, low);
}
