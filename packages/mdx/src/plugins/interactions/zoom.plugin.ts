/**
 * @file mdx/plugins/interactions/zoom.plugin.ts
 * @desc 点击放大 SVG（Mermaid / SVG 代码块）的灯箱插件。
 *       支持滚轮缩放、拖拽平移、双击重置，元素过多时可放大查看细节。
 */

import type { MDxPlugin, PluginContext } from '../../core/types';

const DEFAULT_SELECTOR = [
  'pre code.language-mermaid svg',
  '.mermaid svg',
  '.mdx-svg-container svg',
].join(', ');

export interface ZoomPluginOptions {
  /** 可点击放大的 SVG 选择器 */
  selector?: string;
  /** 最小缩放倍率 */
  minScale?: number;
  /** 最大缩放倍率 */
  maxScale?: number;
  /** 滚轮 / 按钮单步缩放倍率 */
  scaleStep?: number;
}

export class ZoomPlugin implements MDxPlugin {
  name = 'interaction:zoom';

  private options: Required<ZoomPluginOptions>;
  private cleanupFns: Array<() => void> = [];

  private overlay: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private inner: HTMLElement | null = null;
  private ratioEl: HTMLElement | null = null;
  private lockButton: HTMLButtonElement | null = null;

  private scale = 1;
  private fitScale = 1;
  private tx = 0;
  private ty = 0;
  private baseWidth = 1;
  private baseHeight = 1;
  private zoomLocked = false;

  private drag = { active: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };

  constructor(options: ZoomPluginOptions = {}) {
    this.options = {
      selector: options.selector ?? DEFAULT_SELECTOR,
      minScale: options.minScale ?? 0.2,
      maxScale: options.maxScale ?? 10,
      scaleStep: options.scaleStep ?? 1.25,
    };
  }

  install(_context: PluginContext): void {
    const onClick = (e: MouseEvent) => this.handleClick(e);
    const onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    this.cleanupFns.push(
      () => document.removeEventListener('click', onClick),
      () => document.removeEventListener('keydown', onKeydown),
    );
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.disposeOverlay();
  }

  private handleClick(e: MouseEvent): void {
    if (this.overlay) return; // 灯箱已打开
    const svg = (e.target as Element | null)?.closest?.(this.options.selector);
    if (svg) this.open(svg as SVGSVGElement);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.overlay) this.close();
  }

  // ==================== 打开 / 关闭 ====================

  private open(svg: SVGSVGElement): void {
    this.ensureOverlay();
    this.zoomLocked = false;
    this.updateLockState();

    // Record the source's laid-out size before moving into the fullscreen
    // overlay. Zooming changes the clone's actual viewport size so the
    // browser redraws the SVG at every level instead of enlarging a cached
    // compositing layer.
    const sourceRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    this.baseWidth = sourceRect.width || viewBox?.width || svg.width?.baseVal.value || 1;
    this.baseHeight = sourceRect.height || viewBox?.height || svg.height?.baseVal.value || 1;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.style.maxWidth = 'none';
    clone.style.width = '100%';
    clone.style.height = '100%';

    this.inner!.replaceChildren(clone);

    this.overlay!.classList.add('mdx-zoom__overlay--open');
    document.body.classList.add('mdx-zoom--open');

    this.resetToFit();
  }

  private close(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove('mdx-zoom__overlay--open');
    document.body.classList.remove('mdx-zoom--open');
    this.inner?.replaceChildren();
  }

  // ==================== 变换 ====================

  private resetToFit(): void {
    if (!this.inner || !this.stage) return;
    const stageW = this.stage.clientWidth - 32;
    const stageH = this.stage.clientHeight - 32;
    this.fitScale = Math.min(1, stageW / this.baseWidth, stageH / this.baseHeight);
    this.scale = this.fitScale;
    this.tx = (this.stage.clientWidth - this.baseWidth * this.scale) / 2;
    this.ty = (this.stage.clientHeight - this.baseHeight * this.scale) / 2;
    this.applyTransform();
  }

  private applyTransform(): void {
    if (this.inner) {
      // Do not use transform: scale() here. Combined with a promoted layer it
      // makes Chromium/WebKit scale a rasterized snapshot of the SVG. Giving
      // the SVG a real layout size keeps paths and text sharp at high zoom.
      this.inner.style.left = `${this.tx}px`;
      this.inner.style.top = `${this.ty}px`;
      this.inner.style.width = `${this.baseWidth * this.scale}px`;
      this.inner.style.height = `${this.baseHeight * this.scale}px`;
    }
    if (this.ratioEl) {
      this.ratioEl.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!this.stage) return;
    const rect = this.stage.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const next = this.clampScale(this.scale * factor);
    const cx = (mx - this.tx) / this.scale;
    const cy = (my - this.ty) / this.scale;
    this.scale = next;
    this.tx = mx - cx * this.scale;
    this.ty = my - cy * this.scale;
    this.applyTransform();
  }

  private clampScale(v: number): number {
    return Math.min(this.options.maxScale, Math.max(this.options.minScale, v));
  }

  // ==================== 灯箱 DOM ====================

  private ensureOverlay(): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'mdx-zoom__overlay';
    overlay.innerHTML = `
      <div class="mdx-zoom__toolbar">
        <button type="button" class="mdx-zoom__btn" data-zoom-action="out" aria-label="Zoom out">&minus;</button>
        <button type="button" class="mdx-zoom__btn" data-zoom-action="in" aria-label="Zoom in">+</button>
        <span class="mdx-zoom__ratio">100%</span>
        <button type="button" class="mdx-zoom__btn" data-zoom-action="reset" aria-label="Reset zoom">&orarr;</button>
        <button type="button" class="mdx-zoom__btn mdx-zoom__lock" data-zoom-action="lock" aria-label="Lock zoom" aria-pressed="false">&#128275;</button>
        <button type="button" class="mdx-zoom__btn" data-zoom-action="close" aria-label="Close">&times;</button>
      </div>
      <div class="mdx-zoom__stage"></div>
    `;

    const stage = overlay.querySelector<HTMLElement>('.mdx-zoom__stage')!;
    const inner = document.createElement('div');
    inner.className = 'mdx-zoom__inner';
    stage.appendChild(inner);

    overlay.addEventListener('click', e => {
      if (e.target === overlay || (e.target as Element).closest('[data-zoom-action="close"]')) {
        this.close();
        return;
      }
      const action = (e.target as Element).closest<HTMLElement>('[data-zoom-action]');
      if (action) this.runAction(action.dataset.zoomAction!);
    });

    stage.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        if (this.zoomLocked) return;
        this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? this.options.scaleStep : 1 / this.options.scaleStep);
      },
      { passive: false },
    );

    stage.addEventListener('dblclick', () => {
      if (!this.zoomLocked) this.resetToFit();
    });
    stage.addEventListener('pointerdown', e => this.startDrag(e));
    stage.addEventListener('pointermove', e => this.moveDrag(e));
    stage.addEventListener('pointerup', () => this.endDrag());
    stage.addEventListener('pointercancel', () => this.endDrag());

    this.overlay = overlay;
    this.stage = stage;
    this.inner = inner;
    this.ratioEl = overlay.querySelector<HTMLElement>('.mdx-zoom__ratio');
    this.lockButton = overlay.querySelector<HTMLButtonElement>('.mdx-zoom__lock');
    document.body.appendChild(overlay);
  }

  private runAction(action: string): void {
    if (action === 'close') this.close();
    else if (action === 'lock') {
      this.zoomLocked = !this.zoomLocked;
      this.updateLockState();
    }
    else if (this.zoomLocked) return;
    else if (action === 'reset') this.resetToFit();
    else if (this.stage) {
      const rect = this.stage.getBoundingClientRect();
      const factor = action === 'in' ? this.options.scaleStep : 1 / this.options.scaleStep;
      this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }
  }

  private updateLockState(): void {
    if (!this.lockButton || !this.overlay) return;
    this.lockButton.textContent = this.zoomLocked ? '\u{1F512}' : '\u{1F513}';
    this.lockButton.setAttribute('aria-label', this.zoomLocked ? 'Unlock zoom' : 'Lock zoom');
    this.lockButton.setAttribute('aria-pressed', String(this.zoomLocked));

    this.overlay.querySelectorAll<HTMLButtonElement>(
      '[data-zoom-action="in"], [data-zoom-action="out"], [data-zoom-action="reset"]',
    ).forEach(button => {
      button.disabled = this.zoomLocked;
    });
  }

  private disposeOverlay(): void {
    if (this.overlay) {
      document.body.classList.remove('mdx-zoom--open');
      this.overlay.remove();
    }
    this.overlay = this.stage = this.inner = this.ratioEl = this.lockButton = null;
  }

  // ==================== 拖拽 ====================

  private startDrag(e: PointerEvent): void {
    this.drag = { active: true, startX: e.clientX, startY: e.clientY, startTx: this.tx, startTy: this.ty };
    this.stage?.setPointerCapture(e.pointerId);
  }

  private moveDrag(e: PointerEvent): void {
    if (!this.drag.active) return;
    this.tx = this.drag.startTx + (e.clientX - this.drag.startX);
    this.ty = this.drag.startTy + (e.clientY - this.drag.startY);
    this.applyTransform();
  }

  private endDrag(): void {
    this.drag.active = false;
  }
}
