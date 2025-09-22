// GitHub OAuth认证配置和工具函数

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

// 获取存储的用户信息
export function getStoredUser(): GitHubUser | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const userStr = localStorage.getItem('gh_user');
    if (!userStr) return null;
    
    return JSON.parse(userStr);
  } catch (error) {
    console.error('Failed to parse stored user data:', error);
    return null;
  }
}

// 存储认证信息
export function storeAuthData(token: string, user: GitHubUser): void {
  if (typeof window === 'undefined') return;
  
  try {
    // 存储token
    localStorage.setItem('gh_token', token);
    
    // 存储用户信息
    localStorage.setItem('gh_user', JSON.stringify(user));
    
    // 设置过期时间（30天）
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    localStorage.setItem('gh_token_expiry', expiryDate.toISOString());
    
    console.log('Auth data stored successfully');
  } catch (error) {
    console.error('Failed to store auth data:', error);
  }
}

// 清除所有认证数据
export function clearAuthData(): void {
  if (typeof window === 'undefined') return;
  
  const keysToRemove = [
    'gh_token',
    'gh_user',
    'gh_token_expiry',
    'github_token', // 兼容旧版本
    'oauth_state'
  ];
  
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  
  // 清除cookies
  const cookiesToClear = ['gh_token', 'github_token'];
  cookiesToClear.forEach(cookieName => {
    document.cookie = `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  });
  
  console.log('Auth data cleared');
}