// GitHub OAuth config — client_id is intentionally public (travels in every
// authorize URL). The secret lives only in the lfkdsk-auth Cloudflare Worker.
const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || 'Ov23liCg29llKxJ7b0jv';
const AUTH_CALLBACK_URL = 'https://auth.lfkdsk.org/picg/callback';
const OAUTH_SCOPE = 'repo';
const STATE_KEY = 'oauth_state';

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

// Redirect the browser to GitHub's OAuth authorize page. A random state is
// stored in sessionStorage so consumeOAuthFragment() can validate it on return.
export function initiateGitHubOAuth(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: AUTH_CALLBACK_URL,
    scope: OAUTH_SCOPE,
    state,
  });

  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface OAuthSuccess {
  token: string;
  scope: string;
}
export interface OAuthError {
  error: string;
}

// Call this once on the page that receives the OAuth redirect (root "/").
// The lfkdsk-auth worker appends results as a URL fragment:
//   /#oauth_token=<tok>&oauth_scope=<scope>&state=<s>
//   /#oauth_error=<msg>&state=<s>
//
// Returns null if the fragment contains no OAuth payload (normal page load).
export function consumeOAuthFragment(): OAuthSuccess | OAuthError | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.slice(1);
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  if (!params.has('oauth_token') && !params.has('oauth_error')) return null;

  // Consume the fragment immediately — prevents re-processing on refresh.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  const oauthError = params.get('oauth_error');
  if (oauthError) return { error: oauthError };

  const token = params.get('oauth_token');
  const scope = params.get('oauth_scope') || '';
  const returnedState = params.get('state') || '';

  // Validate CSRF state if we stored one.
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (expectedState && returnedState !== expectedState) {
    return { error: 'State mismatch — possible CSRF, please try again' };
  }

  if (!token) return { error: 'No access token received from GitHub' };

  return { token, scope };
}

// 获取存储的用户信息
export function getStoredUser(): GitHubUser | null {
  if (typeof window === 'undefined') return null;

  try {
    const userStr = localStorage.getItem('gh_user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// 存储 OAuth 认证信息（token + 用户信息 + 过期时间）
export function storeAuthData(token: string, user: GitHubUser): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_user', JSON.stringify(user));

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  localStorage.setItem('gh_token_expiry', expiry.toISOString());
}

// 清除所有认证数据
export function clearAuthData(): void {
  if (typeof window === 'undefined') return;

  const keys = ['gh_token', 'gh_user', 'gh_token_expiry', 'github_token', STATE_KEY];
  keys.forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });

  ['gh_token', 'github_token'].forEach(name => {
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  });
}
