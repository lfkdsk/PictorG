import { computeJustifiedRows, DEFAULT_RATIO } from './justifiedLayout';

const opts = { targetRowHeight: 200, gap: 8 };

function makeItems(ratios: number[]) {
  return ratios.map((ratio, i) => ({ item: i, ratio }));
}

describe('computeJustifiedRows', () => {
  it('returns nothing when width is unknown or there are no items', () => {
    expect(computeJustifiedRows(makeItems([1.5]), 0, opts)).toEqual([]);
    expect(computeJustifiedRows([], 1000, opts)).toEqual([]);
  });

  it('fills each non-last row to exactly the container width (minus gaps)', () => {
    // Three 1.5 photos: at the 200px target each is 300px wide → 900 + 16 gaps
    // = 916 > 800, so the first two close a row and scale to fill 800.
    const rows = computeJustifiedRows(makeItems([1.5, 1.5, 1.5]), 800, opts);
    const filled = rows.filter((r) => !r.isLast);
    expect(filled.length).toBeGreaterThan(0);
    for (const row of filled) {
      const total =
        row.tiles.reduce((sum, t) => sum + t.width, 0) +
        opts.gap * (row.tiles.length - 1);
      expect(total).toBeCloseTo(800, 4);
    }
  });

  it('keeps a row at one height and sizes each tile to its own ratio (no crop)', () => {
    const ratios = [2, 0.7, 1.2, 1.8, 1];
    const rows = computeJustifiedRows(makeItems(ratios), 900, opts);
    for (const row of rows) {
      for (const tile of row.tiles) {
        expect(tile.height).toBeCloseTo(row.height, 6);
        // width follows the photo's own ratio → the box matches the image
        expect(tile.width).toBeCloseTo(ratios[tile.item] * tile.height, 6);
      }
    }
  });

  it('left-aligns the last row at the target height instead of stretching', () => {
    const rows = computeJustifiedRows(makeItems([1.5, 1.5, 1.5, 1.5]), 800, opts);
    const last = rows[rows.length - 1];
    expect(last.isLast).toBe(true);
    expect(last.height).toBeCloseTo(opts.targetRowHeight, 6);
  });

  it('caps row height so a lone portrait does not balloon', () => {
    const rows = computeJustifiedRows(makeItems([0.6]), 2000, {
      ...opts,
      maxRowHeight: 320,
    });
    expect(rows[0].height).toBeLessThanOrEqual(320);
  });

  it('substitutes the default ratio for invalid measurements', () => {
    const rows = computeJustifiedRows(
      [
        { item: 'a', ratio: 0 },
        { item: 'b', ratio: NaN },
      ],
      5000,
      opts
    );
    for (const tile of rows.flatMap((r) => r.tiles)) {
      expect(tile.width / tile.height).toBeCloseTo(DEFAULT_RATIO, 6);
    }
  });
});
