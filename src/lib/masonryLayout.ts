// Column ("grid-lanes") masonry geometry. Every item gets the same column
// width; heights vary with aspect ratio; each item drops into the currently
// shortest column so a date-sorted stream packs left-to-right, top-to-bottom
// with no ragged tails. Pure function — no DOM — so it unit-tests cleanly and
// the page just measures container width and renders absolutely-positioned
// tiles from the result.

export type MasonryItem<T> = {
  item: T;
  /** aspect ratio = natural width / height (> 0). */
  ratio: number;
};

export type MasonryTile<T> = {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MasonryResult<T> = {
  tiles: MasonryTile<T>[];
  /** total content height (no trailing gap). */
  height: number;
  columns: number;
  columnWidth: number;
};

/** Fallback ratio (3:2 landscape) for tiles whose image hasn't loaded yet. */
export const DEFAULT_RATIO = 3 / 2;

// Responsive column count, mirroring the deployed grid-lanes breakpoints
// (2 → 7 columns as the viewport widens).
export function columnsForWidth(width: number): number {
  if (width <= 0) return 1;
  if (width < 480) return 2;
  if (width < 720) return 3;
  if (width < 1024) return 4;
  if (width < 1440) return 5;
  if (width < 1800) return 6;
  return 7;
}

export function computeMasonry<T>(
  items: MasonryItem<T>[],
  containerWidth: number,
  { columns, gap }: { columns: number; gap: number }
): MasonryResult<T> {
  const cols = Math.max(1, columns);
  if (containerWidth <= 0 || items.length === 0) {
    return { tiles: [], height: 0, columns: cols, columnWidth: 0 };
  }

  const columnWidth = (containerWidth - gap * (cols - 1)) / cols;
  const colHeights = new Array(cols).fill(0);
  const tiles: MasonryTile<T>[] = [];

  for (const { item, ratio } of items) {
    // Shortest column wins; ties go to the leftmost so order stays stable.
    let c = 0;
    for (let i = 1; i < cols; i++) {
      if (colHeights[i] < colHeights[c]) c = i;
    }
    const r = ratio > 0 && Number.isFinite(ratio) ? ratio : DEFAULT_RATIO;
    const height = columnWidth / r;
    const x = c * (columnWidth + gap);
    const y = colHeights[c];
    tiles.push({ item, x, y, width: columnWidth, height });
    colHeights[c] = y + height + gap;
  }

  const tallest = Math.max(...colHeights);
  return {
    tiles,
    height: Math.max(0, tallest - gap),
    columns: cols,
    columnWidth,
  };
}
