import {
  checkRepositorySecret,
  checkTokenPermissions,
  createRepo,
  listRepos,
  validateToken,
} from './api';

const fetchMock = jest.fn();

describe('GitHub user-scope API helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  it('lists repositories with the expected user repos query', async () => {
    const repos = [{ id: 1, full_name: 'octo/gallery', html_url: 'https://github.com/octo/gallery' }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    });

    await expect(listRepos('token-123')).resolves.toEqual(repos);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.github.com/user/repos?'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token token-123' }),
      })
    );
    expect(fetchMock.mock.calls[0][0]).toContain('visibility=all');
    expect(fetchMock.mock.calls[0][0]).toContain('sort=updated');
  });

  it('maps create repo validation errors to actionable messages', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Validation Failed',
      json: async () => ({ message: 'name already exists' }),
    });

    await expect(createRepo('token-123', 'bad name')).rejects.toThrow(
      '仓库名称 "bad name" 无效，请使用有效的仓库名称'
    );
  });

  it('validates tokens by checking the current user endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await expect(validateToken('token-123')).resolves.toBe(true);
  });

  it('reads token scopes from the GitHub response headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'X-OAuth-Scopes': 'repo, workflow' }),
    });

    await expect(checkTokenPermissions('token-123')).resolves.toEqual({
      hasRepoAccess: true,
      hasWorkflowAccess: true,
      scopes: ['repo', 'workflow'],
    });
  });

  it('reports missing repository secrets without throwing', async () => {
    fetchMock.mockResolvedValueOnce({ status: 404 });

    await expect(
      checkRepositorySecret('token-123', 'octo', 'gallery', 'GH_PAGES_DEPLOY')
    ).resolves.toBe(false);
  });
});
