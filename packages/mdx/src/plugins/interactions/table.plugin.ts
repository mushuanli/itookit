/**
 * @file mdx/plugins/interactions/table.plugin.ts
 * @desc 增强标准 GFM 表格，提供排序和筛选功能
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface TablePluginOptions {
    /**
     * 是否启用排序功能
     * @default true
     */
    enableSorting?: boolean;

    /**
     * 是否启用筛选功能
     * @default false
     */
    enableFiltering?: boolean;

    /**
     * 表格容器的类名
     * @default 'mdx-table-container'
     */
    containerClass?: string;
}

type SortDirection = 'asc' | 'desc' | 'none';

export class TablePlugin implements MDxPlugin {
    name = 'interaction:table';
    private options: Required<TablePluginOptions>;
    private cleanupFns: Array<() => void> = [];

    // 使用 WeakMap 存储表格的原始行数据，以便在筛选/排序取消时恢复
    private tableStateMap = new WeakMap<HTMLTableElement, {
        originalRows: HTMLTableRowElement[];
        currentSort: { colIndex: number; direction: SortDirection } | null;
    }>();

    constructor(options: TablePluginOptions = {}) {
        this.options = {
            enableSorting: options.enableSorting ?? true,
            enableFiltering: options.enableFiltering ?? false,
            containerClass: options.containerClass ?? 'mdx-table-container',
        };
    }

    install(context: PluginContext): void {
        const removeListener = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
            this.processTables(element);
        });

        if (removeListener) {
            this.cleanupFns.push(removeListener);
        }
    }

    destroy(): void {
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];
    }

    /**
     * 处理渲染区域内的所有表格
     */
    private processTables(root: HTMLElement): void {
        const tables = root.querySelectorAll('table');

        tables.forEach((table) => {
            // 1. 包裹表格以支持横向滚动
            if (!table.parentElement?.classList.contains(this.options.containerClass)) {
                const wrapper = document.createElement('div');
                wrapper.className = this.options.containerClass;
                table.parentNode?.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }

            // 2. 初始化状态缓存
            const tbody = table.querySelector('tbody');
            if (!tbody) return;

            const rows = Array.from(tbody.querySelectorAll('tr'));
            this.tableStateMap.set(table, {
                originalRows: rows,
                currentSort: null
            });

            // 3. 启用功能
            const thead = table.querySelector('thead');
            if (thead) {
                if (this.options.enableSorting) {
                    this.initSorting(table, thead, tbody);
                }
                if (this.options.enableFiltering) {
                    this.initFiltering(table, thead, tbody);
                }
            }
        });
    }

    /**
     * 初始化排序功能
     */
    private initSorting(table: HTMLTableElement, thead: HTMLTableSectionElement, tbody: HTMLTableSectionElement): void {
        const headers = thead.querySelectorAll('th');

        headers.forEach((th, colIndex) => {
            th.classList.add('mdx-sortable-header');
            th.setAttribute('title', 'Click to sort');

            const clickHandler = () => {
                this.handleSort(table, tbody, th, colIndex, headers);
            };

            th.addEventListener('click', clickHandler);
            // 存储 handler 引用以便销毁 (简单起见，这里依赖 DOM 销毁自动清理，或可扩展 WeakMap 存储清理函数)
        });
    }

    /**
     * 执行排序逻辑
     */
    private handleSort(
        table: HTMLTableElement,
        tbody: HTMLTableSectionElement,
        targetTh: HTMLTableCellElement,
        colIndex: number,
        allHeaders: NodeListOf<HTMLTableCellElement>
    ): void {
        const state = this.tableStateMap.get(table);
        if (!state) return;

        // 确定新的排序方向
        let newDirection: SortDirection = 'asc';
        if (state.currentSort?.colIndex === colIndex && state.currentSort.direction === 'asc') {
            newDirection = 'desc';
        } else if (state.currentSort?.colIndex === colIndex && state.currentSort.direction === 'desc') {
            newDirection = 'none'; // 第三次点击恢复默认
        }

        // 更新 UI 状态
        allHeaders.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            th.removeAttribute('data-sort');
        });

        if (newDirection === 'none') {
            // 恢复原始顺序
            state.currentSort = null;
            this.renderRows(tbody, state.originalRows);
        } else {
            // 标记 UI
            targetTh.classList.add(`sort-${newDirection}`);
            targetTh.setAttribute('data-sort', newDirection);
            state.currentSort = { colIndex, direction: newDirection };

            // 执行排序
            // 注意：这里我们对当前可见的行进行排序（兼容筛选功能）
            const currentRows = Array.from(tbody.querySelectorAll('tr'));

            currentRows.sort((rowA, rowB) => {
                const cellA = rowA.children[colIndex]?.textContent?.trim() || '';
                const cellB = rowB.children[colIndex]?.textContent?.trim() || '';

                return this.compareCells(cellA, cellB, newDirection);
            });

            this.renderRows(tbody, currentRows);
        }
    }

    /**
     * 智能比较单元格内容
     */
    private compareCells(a: string, b: string, direction: 'asc' | 'desc'): number {
        const numA = parseFloat(a.replace(/[^0-9.-]/g, ''));
        const numB = parseFloat(b.replace(/[^0-9.-]/g, ''));

        let comparison = 0;

        // 如果两者都是有效数字，且字符串不包含太多非数字字符（防止 "Room 101" 被当作 101 比较）
        const isNumA = !isNaN(numA) && /^\d/.test(a);
        const isNumB = !isNaN(numB) && /^\d/.test(b);

        if (isNumA && isNumB) {
            comparison = numA - numB;
        } else {
            // 使用本地化字符串比较
            comparison = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        }

        return direction === 'asc' ? comparison : -comparison;
    }

    /**
     * 初始化筛选功能
     */
    private initFiltering(table: HTMLTableElement, thead: HTMLTableSectionElement, tbody: HTMLTableSectionElement): void {
        // 创建筛选行
        const filterRow = document.createElement('tr');
        filterRow.className = 'mdx-table-filter-row';

        const headerCount = thead.rows[0].cells.length;

        for (let i = 0; i < headerCount; i++) {
            const th = document.createElement('th');
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter...';
            input.className = 'mdx-table-filter-input';

            input.addEventListener('input', () => {
                this.handleFilter(table, tbody, filterRow);
            });

            // 阻止点击输入框时触发排序
            input.addEventListener('click', (e) => e.stopPropagation());

            th.appendChild(input);
            filterRow.appendChild(th);
        }

        thead.appendChild(filterRow);
    }

    /**
     * 执行筛选逻辑
     */
    private handleFilter(table: HTMLTableElement, tbody: HTMLTableSectionElement, filterRow: HTMLTableRowElement): void {
        const state = this.tableStateMap.get(table);
        if (!state) return;

        const inputs = Array.from(filterRow.querySelectorAll('input'));
        const filters = inputs.map(input => input.value.toLowerCase());

        // 检查是否所有过滤器都为空
        const hasFilters = filters.some(f => f !== '');

        if (!hasFilters) {
            // 如果没有过滤器，恢复显示的行（同时保持当前排序）
            // 简便起见，我们让排序逻辑重新运行一次，或者直接显示
            // 这里简单处理：重新显示所有行，排序逻辑会自动保持（因为 DOM 顺序没变）
            state.originalRows.forEach(row => row.style.display = '');
            return;
        }

        // 遍历原始行进行筛选
        state.originalRows.forEach(row => {
            let shouldShow = true;
            const cells = row.cells;

            for (let i = 0; i < filters.length; i++) {
                const filterText = filters[i];
                if (!filterText) continue;

                const cellText = cells[i]?.textContent?.toLowerCase() || '';
                if (!cellText.includes(filterText)) {
                    shouldShow = false;
                    break;
                }
            }

            row.style.display = shouldShow ? '' : 'none';
        });
    }

    /**
     * 重新渲染行
     */
    private renderRows(tbody: HTMLTableSectionElement, rows: HTMLTableRowElement[]): void {
        // 使用 DocumentFragment 优化性能
        const fragment = document.createDocumentFragment();
        rows.forEach(row => fragment.appendChild(row));
        tbody.appendChild(fragment);
    }
}
