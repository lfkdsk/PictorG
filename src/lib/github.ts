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
    // 清除localStorage 中的 token + 用户态 + 已导入画廊缓存
    const localKeys = [
      'gh_token',
      'github_token', // 兼容旧版本
      'gh_user',
      'gh_token_expiry',
      'pictor_galleries',
      'pictor_repos_cache',
    ];
    localKeys.forEach((k) => localStorage.removeItem(k));

    // 清除任何以 annualSummaryDraft: 开头的草稿（每个 owner/repo/year 一条）
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('annualSummaryDraft:'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }

    // 清除所有相关的cookie
    const cookiesToClear = ['gh_token', 'github_token'];
    cookiesToClear.forEach(cookieName => {
      document.cookie = `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
      document.cookie = `${cookieName}=; Path=/; Domain=${window.location.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    });

    // 清除sessionStorage中的相关数据 + annual-summary 草稿
    sessionStorage.removeItem('newAlbumForm');
    sessionStorage.removeItem('uploadedFiles');
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('annualSummaryDraft:'))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch { /* ignore */ }

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
        throw new Error(`创建仓库失败: ${errorData.message || res.statusText} (${res.status})`);
    }
  }
  
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

// 初始化空仓库的函数
// 新的批量提交函数，用于空仓库初始化
export async function initializeEmptyRepoWithBatch(
  token: string,
  owner: string,
  repo: string,
  files: BatchUploadFile[],
  message: string,
  branch: string = 'main'
): Promise<any> {
  try {
    // 对于空仓库，先创建一个初始文件来初始化Git对象存储
    const firstFile = files[0];
    if (!firstFile) {
      throw new Error('No files to upload');
    }

    // 先检查第一个文件是否已存在
    const checkResponse = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${firstFile.path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`
      }
    });

    let requestBody: any = {
      message: `Initialize repository with ${firstFile.path}`,
      content: firstFile.content,
      branch: branch
    };

    // 如果文件已存在，需要提供 sha 来更新
    if (checkResponse.ok) {
      const existingFile = await checkResponse.json();
      requestBody.sha = existingFile.sha;
      requestBody.message = `Update ${firstFile.path}`;
      console.log(`📝 Updating existing file: ${firstFile.path}`);
    } else {
      console.log(`📄 Creating new file: ${firstFile.path}`);
    }

    // 使用Contents API创建或更新第一个文件来初始化仓库
    const initRes = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${firstFile.path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!initRes.ok) {
      const errorData = await initRes.json().catch(() => ({}));
      throw new Error(`Failed to initialize repo: ${initRes.status} - ${errorData.message || initRes.statusText}`);
    }

    console.log(`✅ Repository initialized with ${firstFile.path}`);

    // 如果只有一个文件，直接返回
    if (files.length === 1) {
      return await initRes.json();
    }

    // 等待一下让仓库完全初始化
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 对于剩余的文件，使用批量上传
    const remainingFiles = files.slice(1);
    return await batchUploadFiles(token, owner, repo, remainingFiles, message, branch);

  } catch (error) {
    console.error('Failed to initialize empty repo with batch:', error);
    throw error;
  }
}

export async function initializeEmptyRepo(
  token: string,
  owner: string,
  repo: string,
  files: BatchUploadFile[],
  message: string,
  branch: string = 'main'
): Promise<any> {
  // 分离根目录文件和嵌套目录文件
  const rootFiles = files.filter(file => !file.path.includes('/'));
  const nestedFiles = files.filter(file => file.path.includes('/'));
  
  // 先创建根目录文件来初始化仓库
  for (const file of rootFiles) {
    try {
      // 验证base64编码
      try {
        atob(file.content);
      } catch (e) {
        console.error(`Invalid base64 content for ${file.path}:`, file.content.substring(0, 100));
        throw new Error(`Invalid base64 encoding for ${file.path}`);
      }
      
      // 先检查文件是否已存在
      const checkResponse = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${file.path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token}`
        }
      });

      let requestBody: any = {
        message: `Add ${file.path}`,
        content: file.content,
        branch: branch
      };

      // 如果文件已存在，需要提供 sha 来更新
      if (checkResponse.ok) {
        const existingFile = await checkResponse.json();
        requestBody.sha = existingFile.sha;
        requestBody.message = `Update ${file.path}`;
        console.log(`📝 Updating existing file: ${file.path}`);
      } else {
        console.log(`📄 Creating new file: ${file.path}`);
      }

      const response = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${file.path}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ ${file.path}: ${response.status} - ${errorData.message || response.statusText}`);
        throw new Error(`Failed to create ${file.path}: ${response.status} - ${errorData.message || response.statusText}`);
      }
      
      console.log(`Successfully created: ${file.path}`);
    } catch (error) {
      console.error(`Error creating ${file.path}:`, error);
      throw error;
    }
  }

  // 等待一下让仓库完全初始化
  if (rootFiles.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 增加等待时间
  }

  // 然后创建嵌套目录文件
  for (const file of nestedFiles) {
    try {
      // 验证base64编码
      try {
        atob(file.content);
      } catch (e) {
        console.error(`Invalid base64 content for ${file.path}:`, file.content.substring(0, 100));
        throw new Error(`Invalid base64 encoding for ${file.path}`);
      }
      
      // 等待一下确保目录文件已创建
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 先检查文件是否已存在
      const checkResponse = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${file.path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token}`
        }
      });

      let requestBody: any = {
        message: `Add ${file.path}`,
        content: file.content,
        branch: branch
      };

      // 如果文件已存在，需要提供 sha 来更新
      if (checkResponse.ok) {
        const existingFile = await checkResponse.json();
        requestBody.sha = existingFile.sha;
        requestBody.message = `Update ${file.path}`;
        console.log(`📝 Updating existing file: ${file.path}`);
      } else {
        console.log(`📄 Creating new file: ${file.path}`);
      }

      const response = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${file.path}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token}`
        },
        body: JSON.stringify(requestBody)
      });
      console.log(response);
      if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`❌ ${file.path}: ${response.status} - ${errorData.message || response.statusText}`);
          throw new Error(`Failed to create ${file.path}: ${response.status} - ${errorData.message || response.statusText}`);
        }
      
      console.log(`Successfully created: ${file.path}`);
    } catch (error) {
      console.error(`Error creating ${file.path}:`, error);
      throw error;
    }
  }

  return { message: 'Repository initialized successfully' };
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
  
  let latestCommitSha: string | null = null;
  let baseTreeSha: string | null = null;
  
  if (branchRes.ok) {
    // 仓库已有分支
    const branchData = await branchRes.json();
    latestCommitSha = branchData.object.sha;
    
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
    baseTreeSha = commitData.tree.sha;
  } else if (branchRes.status === 409 || branchRes.status === 404) {
    // 新仓库或空仓库，没有分支，这是正常情况
    console.log('Empty repository, no existing branches');
  } else {
    throw new Error(`Failed to get branch info: ${branchRes.status}`);
  }

  
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
      const errorData = await blobRes.json().catch(() => ({}));
      throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status} - ${errorData.message || blobRes.statusText}`);
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
  const treeBody: any = {
    tree: treeItems
  };
  
  // 只有在有base tree时才添加
  if (baseTreeSha) {
    treeBody.base_tree = baseTreeSha;
  }
  
  const treeRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify(treeBody)
  });
  
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${treeRes.status}`);
  }
  
  const treeData = await treeRes.json();
  
  // Create new commit
  const commitBody: any = {
    message,
    tree: treeData.sha
  };
  
  // 只有在有父提交时才添加
  if (latestCommitSha) {
    commitBody.parents = [latestCommitSha];
  }
  
  const newCommitRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    },
    body: JSON.stringify(commitBody)
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
// 检查GitHub token的权限
export async function checkTokenPermissions(token: string): Promise<{
  hasRepoAccess: boolean;
  hasWorkflowAccess: boolean;
  scopes: string[];
  error?: string;
}> {
  try {
    // 检查token的scopes
    const response = await fetch(`${BASE}/user`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      return {
        hasRepoAccess: false,
        hasWorkflowAccess: false,
        scopes: [],
        error: `Token验证失败: ${response.status}`
      };
    }

    // 从响应头获取scopes
    const scopesHeader = response.headers.get('X-OAuth-Scopes') || '';
    const scopes = scopesHeader.split(',').map(s => s.trim()).filter(s => s);

    // 检查必要的权限
    const hasRepoAccess = scopes.includes('repo') || scopes.includes('public_repo');
    
    // workflow权限检查：
    // 1. 如果有 'repo' 权限，则自动包含workflow权限
    // 2. 如果只有 'public_repo' 权限，则需要额外的 'workflow' 权限
    // 3. 如果有明确的 'workflow' 权限也可以
    const hasWorkflowAccess = (scopes.includes('public_repo') && scopes.includes('workflow')) ||
                             scopes.includes('workflow');

    return {
      hasRepoAccess,
      hasWorkflowAccess,
      scopes,
    };
  } catch (error) {
    return {
      hasRepoAccess: false,
      hasWorkflowAccess: false,
      scopes: [],
      error: `检查权限时出错: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

// 检查仓库是否配置了指定的密钥
export async function checkRepositorySecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string
): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    // 如果返回200，说明密钥存在
    return response.status === 200;
  } catch (error) {
    console.warn('Failed to check repository secret:', error);
    return false;
  }
}

// 获取图片并转换为base64（支持本地静态文件和网络文件）
export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  try {
    // 如果是本地路径，转换为完整URL
    const fullUrl = imageUrl.startsWith('/') ? 
      `${window.location.origin}${imageUrl}` : 
      imageUrl;
    
    const response = await fetch(fullUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // 将ArrayBuffer转换为base64
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    
    return btoa(binary);
  } catch (error) {
    console.error('Failed to fetch image:', error);
    throw error;
  }
}

// 自动导入仓库到项目
export async function importRepoToProject(repo: Repo): Promise<boolean> {
  try {
    const GALLERIES_KEY = 'pictor_galleries';
    
    // 获取现有的画廊列表
    const existingGalleries = JSON.parse(localStorage.getItem(GALLERIES_KEY) || '[]');
    
    // 检查是否已经存在
    const exists = existingGalleries.some((gallery: any) => gallery.full_name === repo.full_name);
    if (exists) {
      console.log('Repository already imported:', repo.full_name);
      return true;
    }
    
    // 添加新的画廊
    const newGallery = {
      id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url
    };
    
    const updatedGalleries = [...existingGalleries, newGallery];
    localStorage.setItem(GALLERIES_KEY, JSON.stringify(updatedGalleries));
    
    console.log('Successfully imported repository:', repo.full_name);
    return true;
  } catch (error) {
    console.error('Failed to import repository:', error);
    return false;
  }
}

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
      // 确保路径匹配的准确性
      const itemPath = item.path;
      const targetPath = directoryPath;
      
      // 完全匹配目录本身
      if (itemPath === targetPath) {
        console.log(`删除目录: ${itemPath}`);
        return false;
      }
      
      // 匹配目录下的所有子文件和子目录
      if (itemPath.startsWith(targetPath + '/')) {
        console.log(`删除子文件: ${itemPath}`);
        return false;
      }
      
      return true;
    });
    
    console.log(`原始文件数: ${treeData.tree.length}, 过滤后文件数: ${filteredTree.length}`);

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

export async function deleteFiles(
  token: string,
  owner: string,
  repo: string,
  filePaths: string[],
  message: string,
  branch?: string
): Promise<any> {
  const targetBranch = branch || await getDefaultBranch(token, owner, repo);

  const uniquePaths = Array.from(new Set(filePaths.map((p) => p.trim()).filter(Boolean)));
  if (uniquePaths.length === 0) {
    throw new Error('没有可删除的文件');
  }

  try {
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
    const deleteSet = new Set(uniquePaths);
    const filteredTree = treeData.tree.filter((item: any) => !deleteSet.has(item.path));

    if (filteredTree.length === treeData.tree.length) {
      throw new Error('未找到要删除的文件');
    }

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
    console.error('删除文件失败:', error);
    throw error;
  }
}
