import {
  clearAuthData,
  consumeOAuthFragment,
  getStoredUser,
  storeAuthData,
  type GitHubUser,
} from './auth';

const user: GitHubUser = {
  id: 1,
  login: 'octo',
  name: 'Octo Cat',
  email: 'octo@example.com',
  avatar_url: 'https://example.com/avatar.png',
  html_url: 'https://github.com/octo',
  public_repos: 2,
  followers: 3,
  following: 4,
  created_at: '2020-01-01T00:00:00Z',
};

describe('auth helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'gh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    history.replaceState(null, '', '/');
  });

  it('stores and reads the authenticated GitHub user', () => {
    storeAuthData('token-123', user);

    expect(localStorage.getItem('gh_token')).toBe('token-123');
    expect(getStoredUser()).toEqual(user);
    expect(localStorage.getItem('gh_token_expiry')).toEqual(expect.any(String));
  });

  it('returns null when no OAuth payload is present', () => {
    history.replaceState(null, '', '/main#plain-anchor');

    expect(consumeOAuthFragment()).toBeNull();
    expect(window.location.hash).toBe('#plain-anchor');
  });

  it('consumes a successful OAuth fragment after validating state', () => {
    sessionStorage.setItem('oauth_state', 'state-1');
    history.replaceState(
      null,
      '',
      '/#oauth_token=token-123&oauth_scope=repo&state=state-1'
    );

    expect(consumeOAuthFragment()).toEqual({ token: 'token-123', scope: 'repo' });
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('oauth_state')).toBeNull();
  });

  it('rejects OAuth callbacks with mismatched state', () => {
    sessionStorage.setItem('oauth_state', 'expected-state');
    history.replaceState(
      null,
      '',
      '/#oauth_token=token-123&oauth_scope=repo&state=wrong-state'
    );

    expect(consumeOAuthFragment()).toEqual({
      error: 'State mismatch — possible CSRF, please try again',
    });
  });

  it('clears auth data from local and session storage', () => {
    storeAuthData('token-123', user);
    localStorage.setItem('github_token', 'legacy-token');
    sessionStorage.setItem('oauth_state', 'state-1');

    clearAuthData();

    expect(localStorage.getItem('gh_token')).toBeNull();
    expect(localStorage.getItem('github_token')).toBeNull();
    expect(localStorage.getItem('gh_user')).toBeNull();
    expect(sessionStorage.getItem('oauth_state')).toBeNull();
  });
});
