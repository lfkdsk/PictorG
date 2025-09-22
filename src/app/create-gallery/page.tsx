'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './create-gallery.module.css';
import { 
  GALLERY_TEMPLATE_VARIABLES, 
  getGalleryTemplate, 
  processTemplateFiles,
  type TemplateVariable 
} from '@/templates/gallery-template';
import { createRepo, batchUploadFiles, initializeEmptyRepo, initializeEmptyRepoWithBatch, getGitHubToken, checkRepositorySecret, checkTokenPermissions, importRepoToProject, fetchImageAsBase64 } from '@/lib/github';
import { getStoredUser } from '@/lib/auth';

interface FormData {
  [key: string]: string;
}

export default function CreateGalleryPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [repoNameError, setRepoNameError] = useState<string>('');
  const [isExistingRepo, setIsExistingRepo] = useState<boolean>(false);
  const [secretConfigured, setSecretConfigured] = useState<boolean>(false);
  const [checkingSecret, setCheckingSecret] = useState<boolean>(false);
  const [hasCheckedSecret, setHasCheckedSecret] = useState<boolean>(false);
  const [creationLogs, setCreationLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [tokenPermissions, setTokenPermissions] = useState<{
    hasRepoAccess: boolean;
    hasWorkflowAccess: boolean;
    scopes: string[];
    error?: string;
  } | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState<boolean>(false);

  const totalSteps = 4;

  // 初始化表单数据
  const initializeFormData = () => {
    const initialData: FormData = {};
    
    // 自动填充用户信息
    if (user) {
      initialData.USER_NAME = user.login;
      initialData.GIT_USER = user.name || user.login;
      initialData.GIT_EMAIL = user.email || '';
      initialData.FOOTER_LINK = user.html_url;
    }
    
    // 设置默认值
    GALLERY_TEMPLATE_VARIABLES.forEach(variable => {
      if (variable.defaultValue && !initialData[variable.key]) {
        initialData[variable.key] = variable.defaultValue;
      }
    });
    
    setFormData(initialData);
  };

  // 组件挂载时获取用户信息并初始化
  useEffect(() => {
    const loadUserInfo = async () => {
      // 首先尝试从存储中获取用户信息
      let storedUser = getStoredUser();
      
      // 如果没有存储的用户信息，使用token请求
      if (!storedUser) {
        const token = getGitHubToken();
        if (token) {
          try {
            const response = await fetch('https://api.github.com/user', {
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
              }
            });
            
            if (response.ok) {
              storedUser = await response.json();
            }
          } catch (error) {
            console.error('Failed to fetch user info:', error);
          }
        }
      }
      
      setUser(storedUser);
      
      if (storedUser) {
        const initialData: FormData = {};
        
        // 自动填充用户信息
        initialData.USER_NAME = storedUser.login;
        initialData.GIT_USER = storedUser.name || storedUser.login;
        initialData.GIT_EMAIL = storedUser.email || '';
        initialData.FOOTER_LINK = storedUser.html_url;
        
        // 设置默认值
        GALLERY_TEMPLATE_VARIABLES.forEach(variable => {
          if (variable.defaultValue && !initialData[variable.key]) {
            initialData[variable.key] = variable.defaultValue;
          }
        });
        
        setFormData(initialData);
      }
    };
    
    loadUserInfo();
    // 自动检查token权限
    checkTokenPermissionsFunc();
  }, []);

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));
    
    // 检查仓库名称
    if (key === 'REPO_NAME') {
      checkRepoName(value);
    }
  };

  const addLog = (message: string) => {
    setCreationLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${message}`]);
  };

  const checkTokenPermissionsFunc = async () => {
    const token = getGitHubToken();
    if (!token) {
      setTokenPermissions({
        hasRepoAccess: false,
        hasWorkflowAccess: false,
        scopes: [],
        error: '未找到GitHub Token'
      });
      return;
    }

    setCheckingPermissions(true);
    try {
      const permissions = await checkTokenPermissions(token);
      setTokenPermissions(permissions);
    } catch (error) {
      setTokenPermissions({
        hasRepoAccess: false,
        hasWorkflowAccess: false,
        scopes: [],
        error: `检查权限失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
    } finally {
      setCheckingPermissions(false);
    }
  };

  const checkSecretConfiguration = async () => {
    if (!formData.USER_NAME || !formData.REPO_NAME) return;
    
    setCheckingSecret(true);
    const token = getGitHubToken();
    if (!token) {
      setCheckingSecret(false);
      return;
    }

    try {
      const hasSecret = await checkRepositorySecret(
        token,
        formData.USER_NAME,
        formData.REPO_NAME,
        'GH_PAGES_DEPLOY'
      );
      setSecretConfigured(hasSecret);
      setHasCheckedSecret(true);
    } catch (error) {
      console.error('Failed to check secret configuration:', error);
      setSecretConfigured(false);
      setHasCheckedSecret(true);
    } finally {
      setCheckingSecret(false);
    }
  };

  const checkRepoName = async (repoName: string) => {
    if (!repoName.trim() || !user) {
      setRepoNameError('');
      return;
    }

    const token = getGitHubToken();
    if (!token) return;

    try {
      // 检查仓库是否已存在
      const response = await fetch(`https://api.github.com/repos/${user.login}/${repoName}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (response.status === 200) {
        const repoData = await response.json();
        
        // 检查仓库是否为空
        if (repoData.size === 0) {
          setRepoNameError(''); // 空仓库，可以使用
        } else {
          setRepoNameError('仓库已存在且包含内容，请使用其他名称或空仓库');
        }
      } else if (response.status === 404) {
        setRepoNameError(''); // 仓库不存在，可以使用
      }
    } catch (error) {
      // 网络错误等，不显示错误
      console.warn('Failed to check repo name:', error);
    }
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(
          formData.REPO_NAME && 
          user && 
          !repoNameError && 
          tokenPermissions && 
          tokenPermissions.hasRepoAccess && 
          tokenPermissions.hasWorkflowAccess
        );
      case 2:
        return !!(formData.GIT_USER && formData.GIT_EMAIL);
      case 3:
        return !!(formData.GALLERY_TITLE);
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
      setError(null);
    } else {
      setError('请填写所有必填字段');
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError(null);
  };

  const createGallery = async () => {
    setLoading(true);
    setError(null);
    setCreationLogs([]);
    setShowLogs(true);
    
    addLog('🚀 开始创建画廊...');

    try {
      const token = getGitHubToken();
      if (!token) {
        throw new Error('未找到GitHub token，请先登录');
      }

      // 1. 检查仓库是否已存在，如果不存在则创建
      addLog('🔍 检查仓库是否存在...');
      let repo;
      try {
        const checkResponse = await fetch(`https://api.github.com/repos/${formData.USER_NAME}/${formData.REPO_NAME}`, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json'
          }
        });
        
        if (checkResponse.status === 200) {
          // 仓库已存在，直接使用
          repo = await checkResponse.json();
          setIsExistingRepo(true);
          addLog(`📁 使用现有仓库: ${repo.full_name}`);
        } else {
          // 仓库不存在，创建新仓库
          addLog('📝 创建新仓库...');
          repo = await createRepo(token, formData.REPO_NAME, false);
          setIsExistingRepo(false);
          addLog(`✅ 成功创建仓库: ${repo.full_name}`);
        }
      } catch (error) {
        // 如果检查失败，尝试创建仓库
        addLog('📝 创建新仓库...');
        repo = await createRepo(token, formData.REPO_NAME, false);
        addLog(`✅ 成功创建仓库: ${repo.full_name}`);
      }
      
      // 2. 处理模板文件
      addLog('📄 处理模板文件...');
      const template = getGalleryTemplate();
      let processedFiles = processTemplateFiles(template, formData);
      
      // 3. 获取需要下载的文件
      const filesToDownload = processedFiles.filter(file => file.url && !file.content);
      if (filesToDownload.length > 0) {
        addLog(`🖼️ 下载 ${filesToDownload.length} 个网络文件...`);
        
        for (const file of filesToDownload) {
          try {
            addLog(`📥 从本地下载 ${file.path}...`);
            console.log(`Downloading from: ${file.url}`);
            const base64Content = await fetchImageAsBase64(file.url!);
            // 更新文件内容
            processedFiles = processedFiles.map(f => {
              if (f.path === file.path) {
                return { ...f, content: base64Content };
              }
              return f;
            });
            addLog(`✅ ${file.path} 下载完成 (${Math.round(base64Content.length / 1024)}KB)`);
          } catch (error) {
            addLog(`⚠️ ${file.path} 下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
            console.error(`Download error for ${file.path}:`, error);
            // 移除下载失败的文件
            processedFiles = processedFiles.filter(f => f.path !== file.path);
          }
        }
      }
      
      addLog(`📋 生成了 ${processedFiles.length} 个文件`);
      
      // 4. 等待一下让仓库完全初始化
      addLog('⏳ 等待仓库初始化...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 5. 根据仓库状态选择上传方法
      addLog('🔄 准备上传文件...');
      const fileData = processedFiles.map(file => ({
        path: file.path,
        content: file.encoding === 'base64' 
          ? file.content  // 已经是base64编码的文件（如图片），直接使用
          : btoa(unescape(encodeURIComponent(file.content))) // UTF-8文件需要编码
      }));

      // 检查仓库是否为空（新仓库或空仓库）
      const isEmpty = repo.size === 0 || !isExistingRepo;
      
      if (isEmpty) {
        // 空仓库或新仓库，使用批量初始化方法
        addLog('📤 使用批量提交方法初始化仓库...');
        await initializeEmptyRepoWithBatch(
          token,
          formData.USER_NAME,
          formData.REPO_NAME,
          fileData,
          'Initial gallery setup by PicG',
          'main'
        );
        addLog('✅ 所有文件已批量提交到仓库');
      } else {
        // 有内容的仓库，使用批量上传
        addLog('📤 使用批量上传方法上传文件...');
        await batchUploadFiles(
          token,
          formData.USER_NAME,
          formData.REPO_NAME,
          fileData,
          'Initial gallery setup by PicG',
          'main'
        );
        addLog('✅ 所有文件已批量上传到仓库');
      }

      // 6. 自动导入仓库到项目
      addLog('📥 自动导入仓库到项目...');
      const importSuccess = await importRepoToProject(repo);
      if (importSuccess) {
        addLog('✅ 仓库已自动导入到项目');
      } else {
        addLog('⚠️ 仓库导入失败，请手动添加');
      }
      
      // 7. 完成创建
      addLog('🎉 画廊创建完成！');
      addLog('✅ 所有文件已成功上传到GitHub');
      
      // 等待一下让用户看到完成日志
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 8. 跳转到成功页面
      setCurrentStep(4);
      
    } catch (err) {
      console.error('创建画廊失败:', err);
      setError(err instanceof Error ? err.message : '创建画廊失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className={styles.stepContent}>
            <h2>📝 基本信息</h2>
            <p className={styles.stepDescription}>设置画廊的基本信息和仓库名称</p>
            
            {user && (
              <div className={styles.formGroup}>
                <label>当前登录用户</label>
                <div className={styles.userInfo}>
                  <img src={user.avatar_url} alt={user.login} className={styles.userAvatar} />
                  <div className={styles.userDetails}>
                    <div className={styles.userName}>{user.name || user.login}</div>
                    <div className={styles.userLogin}>@{user.login}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Token权限检查 */}
            <div className={styles.formGroup}>
              <label>GitHub Token权限检查</label>
              <div style={{ marginTop: '10px' }}>
                <button
                  onClick={checkTokenPermissionsFunc}
                  disabled={checkingPermissions}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: checkingPermissions ? 'not-allowed' : 'pointer',
                    opacity: checkingPermissions ? 0.6 : 1
                  }}
                >
                  {checkingPermissions ? '🔍 检查中...' : '🔍 检查Token权限'}
                </button>
                
                {tokenPermissions && (
                  <div style={{ marginTop: '10px' }}>
                    {tokenPermissions.error ? (
                      <div style={{ color: '#dc3545', fontWeight: 'bold' }}>
                        ❌ {tokenPermissions.error}
                      </div>
                    ) : (
                      <div>
                        <div style={{ 
                          color: tokenPermissions.hasRepoAccess ? '#28a745' : '#dc3545',
                          fontWeight: 'bold'
                        }}>
                          {tokenPermissions.hasRepoAccess ? '✅' : '❌'} 仓库访问权限 
                          <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6c757d' }}>
                            (需要 repo 或 public_repo)
                          </span>
                        </div>
                        <div style={{ 
                          color: tokenPermissions.hasWorkflowAccess ? '#28a745' : '#dc3545',
                          fontWeight: 'bold'
                        }}>
                          {tokenPermissions.hasWorkflowAccess ? '✅' : '❌'} 工作流权限
                          <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6c757d' }}>
                            (repo权限包含，或需要单独的workflow权限)
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px' }}>
                          当前权限: {tokenPermissions.scopes.join(', ') || '无'}
                        </div>
                        {(!tokenPermissions.hasRepoAccess || !tokenPermissions.hasWorkflowAccess) && (
                          <div style={{ 
                            backgroundColor: '#fff3cd', 
                            border: '1px solid #ffeaa7', 
                            borderRadius: '4px', 
                            padding: '8px', 
                            marginTop: '10px',
                            fontSize: '12px'
                          }}>
                            ⚠️ Token权限不足！<br/>
                            • 仓库权限：需要 <code>repo</code> (完整权限) 或 <code>public_repo</code> (公开仓库)<br/>
                            • 工作流权限：<code>repo</code> 权限已包含，或需要单独的 <code>workflow</code> 权限
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className={styles.formGroup}>
              <label>画廊名称 *</label>
              <input
                type="text"
                value={formData.REPO_NAME || ''}
                onChange={(e) => handleInputChange('REPO_NAME', e.target.value)}
                placeholder="my-gallery"
              />
              {repoNameError && (
                <div className={styles.errorText}>{repoNameError}</div>
              )}
              {!repoNameError && formData.REPO_NAME && (
                <div className={styles.successText}>✅ 仓库名称可用（支持新建或使用空仓库）</div>
              )}
              <div className={styles.fieldHint}>
                将作为GitHub仓库名称，部署地址为: {formData.USER_NAME || user?.login || 'username'}.github.io/{formData.REPO_NAME || 'repo-name'}
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className={styles.stepContent}>
            <h2>👤 Git配置</h2>
            <p className={styles.stepDescription}>配置Git提交信息，用于GitHub Actions</p>
            
            <div className={styles.formGroup}>
              <label>Git用户名 *</label>
              <input
                type="text"
                value={formData.GIT_USER || ''}
                onChange={(e) => handleInputChange('GIT_USER', e.target.value)}
                placeholder="Your Name"
              />
              <div className={styles.fieldHint}>用于Git提交的用户名</div>
            </div>

            <div className={styles.formGroup}>
              <label>Git邮箱 *</label>
              <input
                type="email"
                value={formData.GIT_EMAIL || ''}
                onChange={(e) => handleInputChange('GIT_EMAIL', e.target.value)}
                placeholder="your.email@example.com"
              />
              <div className={styles.fieldHint}>用于Git提交的邮箱地址</div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className={styles.stepContent}>
            <h2>🎨 画廊设置</h2>
            <p className={styles.stepDescription}>自定义画廊的显示信息</p>
            
            <div className={styles.formGroup}>
              <label>画廊标题 *</label>
              <input
                type="text"
                value={formData.GALLERY_TITLE || ''}
                onChange={(e) => handleInputChange('GALLERY_TITLE', e.target.value)}
                placeholder="我的摄影画廊"
              />
            </div>

            <div className={styles.formGroup}>
              <label>画廊副标题</label>
              <input
                type="text"
                value={formData.GALLERY_SUBTITLE || ''}
                onChange={(e) => handleInputChange('GALLERY_SUBTITLE', e.target.value)}
                placeholder="用镜头记录美好时光"
              />
            </div>

            <div className={styles.formGroup}>
              <label>画廊描述</label>
              <textarea
                value={formData.GALLERY_DESCRIPTION || ''}
                onChange={(e) => handleInputChange('GALLERY_DESCRIPTION', e.target.value)}
                placeholder="这是我的个人摄影画廊，记录生活中的美好瞬间"
                rows={3}
              />
            </div>

            <div className={styles.formGroup}>
              <label>底部链接</label>
              <input
                type="url"
                value={formData.FOOTER_LINK || ''}
                onChange={(e) => handleInputChange('FOOTER_LINK', e.target.value)}
                placeholder="https://your-website.com"
              />
            </div>

            {showLogs && (
              <div className={styles.logsContainer}>
                <h3>📋 创建日志</h3>
                <div className={styles.logsBox}>
                  {creationLogs.map((log, index) => (
                    <div key={index} className={styles.logItem}>
                      {log}
                    </div>
                  ))}
                  {loading && (
                    <div className={styles.logItem} style={{ color: '#007bff' }}>
                      <span className={styles.spinner}>⏳</span> 正在处理...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div className={`${styles.stepContent} ${styles.success}`}>
            <div className={styles.successIcon}>🎉</div>
            <h2>画廊{isExistingRepo ? '初始化' : '创建'}成功！</h2>
            <p>你的画廊已经成功{isExistingRepo ? '初始化到现有仓库' : '创建'}并部署到GitHub。</p>
            
            <div className={styles.successInfo}>
              <div className={styles.infoItem}>
                <strong>仓库地址:</strong>
                <a 
                  href={`https://github.com/${formData.USER_NAME}/${formData.REPO_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/{formData.USER_NAME}/{formData.REPO_NAME}
                </a>
              </div>
              
              <div className={styles.infoItem}>
                <strong>部署地址:</strong>
                <a 
                  href={`https://${formData.USER_NAME}.github.io/${formData.REPO_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {formData.USER_NAME}.github.io/{formData.REPO_NAME}
                </a>
              </div>
            </div>

            <div className={styles.nextSteps}>
              <h3>📋 接下来的步骤</h3>
              <ol>
                <li>
                  <strong>配置GitHub Pages部署密钥:</strong>
                  <br />
                  前往 
                  <a 
                    href={`https://github.com/${formData.USER_NAME}/${formData.REPO_NAME}/settings/secrets/actions/new`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    仓库设置 → Secrets and variables → Actions
                  </a>
                  <br />
                  添加名为 <code>GH_PAGES_DEPLOY</code> 的密钥
                  <br />
                  <div style={{ marginTop: '10px' }}>
                    <button
                      onClick={checkSecretConfiguration}
                      disabled={checkingSecret}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: secretConfigured ? '#28a745' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: checkingSecret ? 'not-allowed' : 'pointer',
                        opacity: checkingSecret ? 0.6 : 1
                      }}
                    >
                      {checkingSecret ? '🔍 检查中...' : 
                       secretConfigured ? '✅ 密钥已配置' : '🔍 检查密钥配置'}
                    </button>
                    {hasCheckedSecret && secretConfigured && (
                        <span style={{ marginLeft: '10px', color: '#28a745', fontWeight: 'bold' }}>
                          ✅ 部署密钥配置正确！
                        </span>
                      )}
                      {hasCheckedSecret && !checkingSecret && !secretConfigured && (
                        <span style={{ marginLeft: '10px', color: '#dc3545', fontWeight: 'bold' }}>
                          ❌ 未检测到 GH_PAGES_DEPLOY 密钥，请先配置
                        </span>
                      )}
                  </div>
                </li>
                <li>
                  <strong>启用GitHub Actions:</strong>
                  <br />
                  前往 
                  <a 
                    href={`https://github.com/${formData.USER_NAME}/${formData.REPO_NAME}/actions/workflows/main.yml`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Actions页面
                  </a>
                  启用工作流
                </li>
                <li>
                  <strong>开始管理画廊:</strong>
                  <br />
                  返回PicG主页面，选择新创建的仓库开始添加相册
                </li>
              </ol>
            </div>

            {!secretConfigured && (
              <div className={styles.infoItem} style={{ 
                backgroundColor: '#fff3cd', 
                border: '1px solid #ffeaa7', 
                borderRadius: '8px', 
                padding: '12px', 
                marginTop: '20px' 
              }}>
                <strong>⚠️ 重要提醒：</strong>
                <br />
                请先配置好GitHub Pages部署密钥，然后点击上方的"检查密钥配置"按钮验证，才能正常使用自动部署功能。
              </div>
            )}

            <div className={styles.actionButtons}>
              <button 
                className={styles.primaryBtn}
                onClick={() => router.push('/main')}
              >
                返回主页
              </button>
              <button 
                className={styles.secondaryBtn}
                onClick={() => window.open(`https://github.com/${formData.USER_NAME}/${formData.REPO_NAME}/actions`, '_blank')}
              >
                打开Actions页面
              </button>
              {secretConfigured && (
                <button 
                  className={styles.primaryBtn}
                  onClick={() => window.open(`https://github.com/${formData.USER_NAME}/${formData.REPO_NAME}/actions/workflows/main.yml`, '_blank')}
                  style={{ backgroundColor: '#28a745' }}
                >
                  🚀 触发首次部署
                </button>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.createGalleryContainer}>
      <div className={styles.createGalleryContent}>
        <div className={styles.header}>
          <h1>创建新画廊</h1>
          <div className={styles.progressBar}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <div 
                key={i}
                className={`${styles.progressStep} ${i + 1 <= currentStep ? styles.active : ''}`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className={styles.errorMessage}>
            ⚠️ {error}
          </div>
        )}

        {renderStepContent()}

        {currentStep < 4 && (
          <div className={styles.navigation}>
            {currentStep > 1 && (
              <button 
                className={`${styles.navBtn} ${styles.prev}`}
                onClick={prevStep}
                disabled={loading}
              >
                ← 上一步
              </button>
            )}
            
            {currentStep < 3 ? (
              <button 
                className={`${styles.navBtn} ${styles.next}`}
                onClick={nextStep}
                disabled={!validateStep(currentStep)}
              >
                下一步 →
              </button>
            ) : (
              <button 
                className={`${styles.navBtn} ${styles.create}`}
                onClick={createGallery}
                disabled={loading || !validateStep(currentStep)}
              >
                {loading ? '创建中...' : '创建画廊'}
              </button>
            )}
          </div>
        )}
      </div>


    </div>
  );
}