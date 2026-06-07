import {
  columnsForWidth,
  computeMasonry,
  DEFAULT_RATIO,
  type MasonryItem,
} from './masonryLayout';

const items = (ratios: number[]): MasonryItem<number>[] =>
  ratios.map((ratio, i) => ({ item: i, ratio }));

describe('columnsForWidth', () => {
  it('scales 1 → 7 columns across the breakpoints', () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(400)).toBe(2);
    expect(columnsForWidth(600)).toBe(3);
    expect(columnsForWidth(900)).toBe(4);
    expect(columnsForWidth(1200)).toBe(5);
    expect(columnsForWidth(1600)).toBe(6);
    expect(columnsForWidth(2000)).toBe(7);
  });
});

describe('computeMasonry', () => {
  it('returns nothing when width or items are absent', () => {
    expect(computeMasonry(items([1, 1]), 0, { columns: 3, gap: 8 }).tiles).toHaveLength(0);
    expect(computeMasonry([], 800, { columns: 3, gap: 8 }).tiles).toHaveLength(0);
  });

  it('splits width into equal columns accounting for gaps', () => {
    const res = computeMasonry(items([1, 1, 1]), 320, { columns: 3, gap: 10 });
    // (320 - 2*10) / 3 = 100
    expect(res.columnWidth).toBeCloseTo(100);
    expect(res.tiles[0].x).toBeCloseTo(0);
    expect(res.tiles[1].x).toBeCloseTo(110);
    expect(res.tiles[2].x).toBeCloseTo(220);
  });

  it('derives tile height from column width / aspect ratio', () => {
    // ratio 2 (landscape) → height = colWidth / 2
    const res = computeMasonry(items([2]), 200, { columns: 1, gap: 0 });
    expect(res.tiles[0].width).toBeCloseTo(200);
    expect(res.tiles[0].height).toBeCloseTo(100);
  });

  it('fills the first row left-to-right, then drops into the shortest column', () => {
    // 3 columns, all square (ratio 1) → first three go to cols 0,1,2 at y=0,
    // the 4th lands back in column 0 (all equal height → leftmost wins).
    const res = computeMasonry(items([1, 1, 1, 1]), 300, { columns: 3, gap: 0 });
    expect(res.tiles.slice(0, 3).map((t) => t.x)).toEqual([0, 100, 200]);
    expect(res.tiles.slice(0, 3).every((t) => t.y === 0)).toBe(true);
    expect(res.tiles[3].x).toBe(0);
    expect(res.tiles[3].y).toBeCloseTo(100);
  });

  it('sends the next tile to whichever column is currently shortest', () => {
    // col0 gets a tall portrait (ratio 0.5 → height 200), col1 a short
    // landscape (ratio 2 → height 50). The third tile should go to col1.
    const res = computeMasonry(items([0.5, 2, 1]), 200, { columns: 2, gap: 0 });
    // colWidth = 100. tile0 height 200 in col0; tile1 height 50 in col1.
    expect(res.tiles[2].x).toBeCloseTo(100); // column 1 was shorter
    expect(res.tiles[2].y).toBeCloseTo(50);
  });

  it('substitutes the default ratio for non-positive / non-finite values', () => {
    const res = computeMasonry(items([0, NaN, -3]), 100, { columns: 1, gap: 0 });
    const expected = 100 / DEFAULT_RATIO;
    for (const tile of res.tiles) expect(tile.height).toBeCloseTo(expected);
  });

  it('reports total content height without a trailing gap', () => {
    // Single column, two squares (height 100 each) + one gap of 8 between.
    const res = computeMasonry(items([1, 1]), 100, { columns: 1, gap: 8 });
    expect(res.height).toBeCloseTo(208);
  });
});
