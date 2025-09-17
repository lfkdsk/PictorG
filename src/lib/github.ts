export type Repo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
};

const BASE = 'https://api.github.com';

// 通用的Token读取函数
export function getGitHubToken(): string | null {
  // 优先从localStorage读取
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('gh_token');
    if (token) return token;
    
    // 备用：从cookie读取
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'gh_token') {
        return decodeURIComponent(value);
      }
    }
  }
  return null;
}

// 验证GitHub Token是否有效
export async function validateGitHubToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('Token validation failed:', error);
    return false;
  }
}

// 验证当前存储的token是否有效
export async function validateCurrentToken(): Promise<boolean> {
  const token = getGitHubToken();
  if (!token) return false;
  
  return await validateGitHubToken(token);
}

// 清理所有token相关的存储
export function clearGitHubToken(): void {
  if (typeof window !== 'undefined') {
    // 清除localStorage
    localStorage.removeItem('gh_token');
    localStorage.removeItem('github_token'); // 兼容旧版本
    
    // 清除所有相关的cookie
    const cookiesToClear = ['gh_token', 'github_token'];
    cookiesToClear.forEach(cookieName => {
      document.cookie = `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
      document.cookie = `${cookieName}=; Path=/; Domain=${window.location.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    });
    
    // 清除sessionStorage中的相关数据
    sessionStorage.removeItem('newAlbumForm');
    sessionStorage.removeItem('uploadedFiles');
    
    // 清除其他可能的缓存
    try {
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => {
            caches.delete(name);
          });
        });
      }
    } catch (error) {
      console.warn('Failed to clear caches:', error);
    }
  }
}

// 完整的logout函数
export function logout(): void {
  clearGitHubToken();
  
  // 跳转到登录页面
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

// URL编码工具函数，正确处理中文字符
export function encodeGitHubPath(path: string): string {
  // 对路径中的每个部分进行编码，但保留斜杠
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

// URL解码工具函数
export function decodeGitHubPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch (error) {
    console.warn('Failed to decode path:', path, error);
    return path;
  }
}

// 获取仓库的默认分支
export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  try {
    const response = await fetch(`${BASE}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get repository info: ${response.statusText}`);
    }
    
    const repoData = await response.json();
    return repoData.default_branch || 'main';
  } catch (error) {
    console.warn('Failed to get default branch, falling back to main:', error);
    return 'main'; // 默认使用 main 分支
  }
}

export async function listRepos(token: string): Promise<Repo[]> {
  // Include both public and private repos the user can access
  const params = new URLSearchParams({
    per_page: '100',
    visibility: 'all',
    affiliation: 'owner,collaborator,organization_member',
    sort: 'updated'
  });
  const res = await fetch(`${BASE}/user/repos?${params.toString()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });
  if (!res.ok) throw new Error(`Failed to load repos: ${res.status}`);
  return (await res.json()) as Repo[];
}

export async function createRepo(token: string, name: string, isPrivate = false): Promise<Repo> {
  const res = await fetch(`${BASE}/user/repos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify({ name, private: isPrivate })
  });
  if (!res.ok) throw new Error(`Failed to create repo: ${res.status}`);
  return (await res.json()) as Repo;
}

export interface UploadFileOptions {
  owner: string;
  repo: string;
  path: string;
  content: string; // base64 encoded content
  message: string;
  branch?: string;
}

export async function uploadFile(token: string, options: UploadFileOptions): Promise<any> {
  const { owner, repo, path, content, message } = options;
  
  // 动态获取默认分支
  const branch = options.branch || await getDefaultBranch(token, owner, repo);
  
  // First, try to get the existing file to get its SHA (for updates)
  let sha: string | undefined;
  try {
    const existingRes = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`
      }
    });
    if (existingRes.ok) {
      const existingFile = await existingRes.json();
      sha = existingFile.sha;
    }
  } catch (error) {
    // File doesn't exist, which is fine for new uploads
  }

  // Upload or update the file
  const body: any = {
    message,
    content,
    branch
  };
  
  if (sha) {
    body.sha = sha; // Required for updates
  }

  const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to upload file: ${res.status} - ${errorText}`);
  }
  
  return await res.json();
}

// Helper function to convert File to base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Get repository contents (directories)
export async function getRepoContents(token: string, owner: string, repo: string, path: string = ''): Promise<any[]> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });
  
  if (!res.ok) {
    if (res.status === 404) {
      return []; // Repository or path doesn't exist
    }
    throw new Error(`Failed to get repo contents: ${res.status}`);
  }
  
  return await res.json();
}

// Get existing album directories
export async function getExistingAlbumUrls(token: string, owner: string, repo: string): Promise<string[]> {
  const contents = await getRepoContents(token, owner, repo);
  return contents
    .filter(item => item.type === 'dir')
    .map(item => item.name);
}

// 通用的GitHub文件读取函数
export async function fetchGitHubFile(token: string, owner: string, repo: string, path: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
  }
  
  const data = await response.json();
  // 使用 TextDecoder 正确处理 UTF-8 编码
  const binaryString = atob(data.content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// 通用的GitHub文件写入函数
export async function updateGitHubFile(
  token: string, 
  owner: string, 
  repo: string, 
  path: string, 
  content: string, 
  message: string,
  sha?: string,
  branch?: string
): Promise<any> {
  // 动态获取默认分支
  const targetBranch = branch || await getDefaultBranch(token, owner, repo);
  const body: any = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // 正确处理UTF-8编码
    branch: targetBranch
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'Authorization': `token ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`GitHub API错误 (${response.status}): ${errorData}`);
  }

  return await response.json();
}

// 获取文件SHA的函数
export async function getFileSha(token: string, owner: string, repo: string, path: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return undefined;
  } catch (error) {
    return undefined;
  }
}

// Batch upload multiple files in a single commit
export interface BatchUploadFile {
  path: string;
  content: string; // base64 encoded
}

export async function batchUploadFiles(
  token: string, 
  owner: string, 
  repo: string, 
  files: BatchUploadFile[], 
  message: string,
  branch?: string
): Promise<any> {
  // 动态获取默认分支
  const targetBranch = branch || await getDefaultBranch(token, owner, repo);
  // Get the latest commit SHA
  const branchRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });
  
  if (!branchRes.ok) {
    throw new Error(`Failed to get branch info: ${branchRes.status}`);
  }
  
  const branchData = await branchRes.json();
  const latestCommitSha = branchData.object.sha;
  
  // Get the tree SHA from the latest commit
  const commitRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });
  
  if (!commitRes.ok) {
    throw new Error(`Failed to get commit info: ${commitRes.status}`);
  }
  
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;
  
  // Create blobs for all files
  const blobPromises = files.map(async (file) => {
    const blobRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`
      },
      body: JSON.stringify({
        content: file.content,
        encoding: 'base64'
      })
    });
    
    if (!blobRes.ok) {
      throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`);
    }
    
    const blobData = await blobRes.json();
    return {
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha
    };
  });
  
  const treeItems = await Promise.all(blobPromises);
  
  // Create new tree
  const treeRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });
  
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${treeRes.status}`);
  }
  
  const treeData = await treeRes.json();
  
  // Create new commit
  const newCommitRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [latestCommitSha]
    })
  });
  
  if (!newCommitRes.ok) {
    throw new Error(`Failed to create commit: ${newCommitRes.status}`);
  }
  
  const newCommitData = await newCommitRes.json();
  
  // Update branch reference
  const updateRefRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      sha: newCommitData.sha
    })
  });
  
  if (!updateRefRes.ok) {
    throw new Error(`Failed to update branch: ${updateRefRes.status}`);
  }
  
  return newCommitData;
}

// 删除GitHub目录及其所有内容
export async function deleteDirectory(
  token: string,
  owner: string,
  repo: string,
  directoryPath: string,
  message: string,
  branch?: string
): Promise<any> {
  // 动态获取默认分支
  const targetBranch = branch || await getDefaultBranch(token, owner, repo);
  
  try {
    // 1. 获取目录下的所有文件
    const response = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${encodeGitHubPath(directoryPath)}?ref=${targetBranch}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('目录不存在');
      }
      throw new Error(`获取目录内容失败: ${response.statusText}`);
    }

    const files = await response.json();
    
    if (!Array.isArray(files)) {
      throw new Error('目录路径指向的不是一个目录');
    }

    if (files.length === 0) {
      throw new Error('目录为空，无需删除');
    }

    // 2. 获取当前分支的最新commit SHA
    const branchRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!branchRes.ok) {
      throw new Error(`获取分支信息失败: ${branchRes.statusText}`);
    }

    const branchData = await branchRes.json();
    const latestCommitSha = branchData.object.sha;

    // 3. 获取当前commit的tree
    const commitRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!commitRes.ok) {
      throw new Error(`获取commit信息失败: ${commitRes.statusText}`);
    }

    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // 4. 获取完整的tree，排除要删除的目录
    const treeRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!treeRes.ok) {
      throw new Error(`获取tree信息失败: ${treeRes.statusText}`);
    }

    const treeData = await treeRes.json();
    
    // 5. 过滤掉要删除的目录及其所有子文件
    const filteredTree = treeData.tree.filter((item: any) => {
      return !item.path.startsWith(directoryPath + '/') && item.path !== directoryPath;
    });

    // 6. 创建新的tree
    const newTreeRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        tree: filteredTree.map((item: any) => ({
          path: item.path,
          mode: item.mode,
          type: item.type,
          sha: item.sha
        }))
      })
    });

    if (!newTreeRes.ok) {
      throw new Error(`创建新tree失败: ${newTreeRes.statusText}`);
    }

    const newTreeData = await newTreeRes.json();

    // 7. 创建新的commit
    const newCommitRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        message,
        tree: newTreeData.sha,
        parents: [latestCommitSha]
      })
    });

    if (!newCommitRes.ok) {
      throw new Error(`创建commit失败: ${newCommitRes.statusText}`);
    }

    const newCommitData = await newCommitRes.json();

    // 8. 更新分支引用
    const updateRefRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        sha: newCommitData.sha
      })
    });

    if (!updateRefRes.ok) {
      throw new Error(`更新分支失败: ${updateRefRes.statusText}`);
    }

    return newCommitData;
    
  } catch (error) {
    console.error('删除目录失败:', error);
    throw error;
  }
}
