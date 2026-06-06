'use client';

import { useCallback, useRef, useState } from 'react';

// A justified ("Apple Photos / Flickr") gallery layout. Each photo keeps its
// native aspect ratio; a row is scaled so its photos share one height and the
// row exactly fills the container width. Wide panoramas span most of a row,
// portraits stay narrow — nothing is cropped.
//
// The geometry is a pure function so it can be unit-tested without a DOM. The
// caller measures each image's aspect ratio (natural width / height) however
// it likes — for us that's `<img onLoad>` reading naturalWidth/naturalHeight —
// and feeds the ratios in. Unmeasured images can use DEFAULT_RATIO so the
// layout renders immediately and refines as photos load.

/** Fallback aspect ratio (3:2 landscape) for images not yet measured. */
export const DEFAULT_RATIO = 3 / 2;

export type RatioItem<T> = {
  item: T;
  /** aspect ratio = natural width / natural height (> 0) */
  ratio: number;
};

export type Tile<T> = {
  item: T;
  width: number;
  height: number;
};

export type Row<T> = {
  tiles: Tile<T>[];
  height: number;
  /** true for the trailing row, which is left-aligned at the target height */
  isLast: boolean;
};

export type JustifiedOptions = {
  /** The height rows aim for before being scaled to fill the width. */
  targetRowHeight: number;
  /** Gap between tiles (and the basis for between-row spacing). */
  gap: number;
  /**
   * Upper bound on a scaled row's height so a near-empty row (e.g. one
   * portrait) doesn't balloon. Defaults to 1.6× the target.
   */
  maxRowHeight?: number;
};

/**
 * Partition `items` into justified rows that each fill `containerWidth`.
 * Returns an empty array when the width is unknown (0) or there are no items.
 */
export function computeJustifiedRows<T>(
  items: RatioItem<T>[],
  containerWidth: number,
  { targetRowHeight, gap, maxRowHeight }: JustifiedOptions
): Row<T>[] {
  if (containerWidth <= 0 || items.length === 0) return [];

  const cap = maxRowHeight ?? targetRowHeight * 1.6;
  const rows: Row<T>[] = [];
  let row: RatioItem<T>[] = [];
  let ratioSum = 0;

  const flush = (isLast: boolean) => {
    if (row.length === 0) return;
    const gaps = gap * (row.length - 1);
    const available = Math.max(1, containerWidth - gaps);
    // Last row keeps the target height (left-aligned) rather than stretching a
    // handful of photos across the whole width.
    const rawHeight = isLast ? targetRowHeight : available / ratioSum;
    const height = Math.min(rawHeight, cap);
    const tiles: Tile<T>[] = row.map(({ item, ratio }) => ({
      item,
      width: ratio * height,
      height,
    }));
    rows.push({ tiles, height, isLast });
    row = [];
    ratioSum = 0;
  };

  for (const it of items) {
    // Guard against bad ratios so one zero/NaN can't break the whole layout.
    const ratio = it.ratio > 0 && Number.isFinite(it.ratio) ? it.ratio : DEFAULT_RATIO;
    row.push({ item: it.item, ratio });
    ratioSum += ratio;
    const gaps = gap * (row.length - 1);
    const projectedWidth = ratioSum * targetRowHeight + gaps;
    if (projectedWidth >= containerWidth) flush(false);
  }
  flush(true);
  return rows;
}

/**
 * Track an element's content-box width via ResizeObserver. Returns a callback
 * ref to attach and the latest width (0 until measured / on the server).
 */
export function useElementWidth<E extends HTMLElement = HTMLDivElement>(): {
  ref: (el: E | null) => void;
  width: number;
} {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: E | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { ref, width };
}
