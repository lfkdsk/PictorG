import {
  AlbumNameCollisionError,
  MANAGED_ALBUM_KEYS,
  upsertAlbumEntry,
  type ReadmeData,
} from './readmeAlbum';

// A README.yml as build.py sees it: the middle album carries keys PictorG's
// edit form knows nothing about.
const data = (): ReadmeData => ({
  'A 相册': { url: 'A', date: '2024-01-01', style: 'default', cover: 'A/1.webp' },
  屋久島: {
    url: 'Yakushima',
    date: '2024-09-15',
    style: 'fullscreen',
    cover: 'Yakushima/c.webp',
    location: [30.36, 130.53],
    layout: 'spread',
    hidden: false,
    subtitle: '杉と苔と雨のあいだ',
  },
  'C 相册': { url: 'C', date: '2023-05-05', style: 'default', cover: 'C/1.webp' },
});

const edited = {
  url: 'Yakushima',
  date: '2024-09-16',
  style: 'fullscreen',
  cover: 'Yakushima/new.webp',
  location: [30.36, 130.53],
};

describe('upsertAlbumEntry', () => {
  it('preserves keys the edit form does not manage', () => {
    const out = upsertAlbumEntry(data(), { oldName: '屋久島', newName: '屋久島', entry: edited });
    expect(out['屋久島']).toEqual({
      ...edited,
      layout: 'spread',
      hidden: false,
      subtitle: '杉と苔と雨のあいだ',
    });
  });

  it('applies the form values for keys it does manage', () => {
    const out = upsertAlbumEntry(data(), { oldName: '屋久島', newName: '屋久島', entry: edited });
    expect(out['屋久島'].cover).toBe('Yakushima/new.webp');
    expect(out['屋久島'].date).toBe('2024-09-16');
  });

  it('clears a managed key that the form omitted', () => {
    // location dropped from the form → it must really go, not resurrect
    const { location, ...noLoc } = edited;
    const out = upsertAlbumEntry(data(), { oldName: '屋久島', newName: '屋久島', entry: noLoc });
    expect('location' in out['屋久島']).toBe(false);
    expect(out['屋久島'].layout).toBe('spread');
  });

  it('keeps the entry in place on rename (README.yml order = site order)', () => {
    const out = upsertAlbumEntry(data(), { oldName: '屋久島', newName: '屋久島 2024', entry: edited });
    expect(Object.keys(out)).toEqual(['A 相册', '屋久島 2024', 'C 相册']);
    expect(out['屋久島 2024'].layout).toBe('spread');
    expect('屋久島' in out).toBe(false);
  });

  it('appends when the album is new', () => {
    const out = upsertAlbumEntry(data(), { oldName: null, newName: 'D 相册', entry: edited });
    expect(Object.keys(out)).toEqual(['A 相册', '屋久島', 'C 相册', 'D 相册']);
  });

  it('refuses to clobber a different album on rename', () => {
    expect(() =>
      upsertAlbumEntry(data(), { oldName: '屋久島', newName: 'C 相册', entry: edited })
    ).toThrow(AlbumNameCollisionError);
  });

  it('does not mutate the input', () => {
    const before = data();
    upsertAlbumEntry(before, { oldName: '屋久島', newName: '屋久島 2024', entry: edited });
    expect(Object.keys(before)).toEqual(['A 相册', '屋久島', 'C 相册']);
    expect(before['屋久島'].cover).toBe('Yakushima/c.webp');
  });

  it('survives a malformed entry', () => {
    const out = upsertAlbumEntry({ bad: null as never }, {
      oldName: 'bad',
      newName: 'bad',
      entry: edited,
    });
    expect(out.bad).toEqual(edited);
  });

  it('manages exactly the keys the edit form renders', () => {
    expect([...MANAGED_ALBUM_KEYS]).toEqual(['url', 'date', 'style', 'cover', 'location']);
  });
});
