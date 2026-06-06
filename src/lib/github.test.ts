import {
  getGitHubToken,
  getRepoContents,
  importRepoToProject,
} from './github';

const fetchMock = jest.fn();

describe('browser GitHub helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'gh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  it('prefers the localStorage GitHub token over cookies', () => {
    localStorage.setItem('gh_token', 'local-token');
    document.cookie = 'gh_token=cookie-token; Path=/';

    expect(getGitHubToken()).toBe('local-token');
  });

  it('falls back to the token cookie when localStorage is empty', () => {
    document.cookie = 'gh_token=cookie-token; Path=/';

    expect(getGitHubToken()).toBe('cookie-token');
  });

  it('imports repositories into the gallery cache without duplicating entries', async () => {
    const repo = {
      id: 1,
      full_name: 'octo/gallery',
      html_url: 'https://github.com/octo/gallery',
    } as any;

    await expect(importRepoToProject(repo)).resolves.toBe(true);
    await expect(importRepoToProject(repo)).resolves.toBe(true);

    expect(JSON.parse(localStorage.getItem('pictor_galleries') || '[]')).toEqual([repo]);
  });

  it('returns an empty directory list for GitHub 404 contents responses', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(getRepoContents('token-123', 'octo', 'gallery', 'missing')).resolves.toEqual([]);
  });

  it('throws for non-404 contents failures', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(getRepoContents('token-123', 'octo', 'gallery', '')).rejects.toThrow(
      'Failed to get repo contents: 500'
    );
  });
});
