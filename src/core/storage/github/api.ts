// GitHub-only top-level operations that don't fit the per-gallery
// StorageAdapter shape. These are kept as standalone functions because they
// live at user-scope (listing/creating repos) or are GitHub-platform-specific
// (token introspection, Actions secrets).

import type { Repo } from '../types';

export const GITHUB_API_BASE = 'https://api.github.com';

const ACCEPT = 'application/vnd.github+json';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: ACCEPT,
  };
}

export async function listRepos(token: string): Promise<Repo[]> {
  const params = new URLSearchParams({
    per_page: '100',
    visibility: 'all',
    affiliation: 'owner,collaborator,organization_member',
    sort: 'updated',
  });
  const res = await fetch(`${GITHUB_API_BASE}/user/repos?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load repos: ${res.status}`);
  return (await res.json()) as Repo[];
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate = false
): Promise<Repo> {
  const res = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: isPrivate }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    switch (res.status) {
      case 409:
        throw new Error(`仓库名称 "${name}" 已存在，请使用其他名称`);
      case 422:
        throw new Error(`仓库名称 "${name}" 无效，请使用有效的仓库名称`);
      case 401:
        throw new Error('GitHub token无效或已过期，请重新登录');
      case 403:
        throw new Error('没有权限创建仓库，请检查token权限');
      default:
        throw new Error(
          `创建仓库失败: ${errorData.message || res.statusText} (${res.status})`
        );
    }
  }

  return (await res.json()) as Repo;
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${GITHUB_API_BASE}/user`, { headers: authHeaders(token) });
    return res.ok;
  } catch (error) {
    console.error('Token validation failed:', error);
    return false;
  }
}

export type TokenPermissions = {
  hasRepoAccess: boolean;
  hasWorkflowAccess: boolean;
  scopes: string[];
  error?: string;
};

export async function checkTokenPermissions(token: string): Promise<TokenPermissions> {
  try {
    const res = await fetch(`${GITHUB_API_BASE}/user`, { headers: authHeaders(token) });

    if (!res.ok) {
      return {
        hasRepoAccess: false,
        hasWorkflowAccess: false,
        scopes: [],
        error: `Token验证失败: ${res.status}`,
      };
    }

    const scopesHeader = res.headers.get('X-OAuth-Scopes') || '';
    const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);

    const hasRepoAccess = scopes.includes('repo') || scopes.includes('public_repo');
    // 'repo' implies workflow scope; 'public_repo' alone needs explicit 'workflow'.
    const hasWorkflowAccess =
      (scopes.includes('public_repo') && scopes.includes('workflow')) ||
      scopes.includes('workflow');

    return { hasRepoAccess, hasWorkflowAccess, scopes };
  } catch (error) {
    return {
      hasRepoAccess: false,
      hasWorkflowAccess: false,
      scopes: [],
      error: `检查权限时出错: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export async function checkRepositorySecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/secrets/${secretName}`,
      { headers: authHeaders(token) }
    );
    return res.status === 200;
  } catch (error) {
    console.warn('Failed to check repository secret:', error);
    return false;
  }
}
