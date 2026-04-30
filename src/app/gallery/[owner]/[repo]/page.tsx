'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import yaml from 'js-yaml';
import { fetchGitHubFile, updateGitHubFile, getFileSha, getGitHubToken, encodeGitHubPath } from '@/lib/github';
import AuthGuard from '@/components/AuthGuard';
import { openGalleryDb } from '@/lib/sqlite';
import {
  listYearsWithPhotos,
  listExistingSummaryYears,
  parseGalleryConfig,
} from '@/lib/annualSummary';

type Config = {
  thumbnail_url: string;
  base_url: string;
  backup_base_url: string;
  backup_thumbnail_url: string;
  url?: string;
};

type SummaryStatus = {
  loading: boolean;
  pendingYears: string[];
  filledYears: string[];
  error: string | null;
};

type Album = {
  name: string;
  url: string;
  date: string | Date;
  style: string;
  cover: string;
  location?: [number, number];
};

export default function GalleryPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;
  
  const [config, setConfig] = useState<Config | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isConfigEditMode, setIsConfigEditMode] = useState(false);
  const [configContent, setConfigContent] = useState<string>('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>({
    loading: false,
    pendingYears: [],
    filledYears: [],
    error: null,
  });



  const saveReadmeToGitHub = async (content: string) => {
    const token = getGitHubToken();
    if (!token) throw new Error('No token found');
    
    setSaving(true);
    try {
      // 首先获取当前文件的 SHA
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.yml`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get file info: ${response.statusText}`);
      }
      
      const fileData = await response.json();
      
      // 更新文件
      const updateResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.yml`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Update README.yml via PicG gallery editor',
          content: btoa(unescape(encodeURIComponent(content))), // 正确编码 UTF-8
          sha: fileData.sha
        })
      });
      
      if (!updateResponse.ok) {
        throw new Error(`Failed to update file: ${updateResponse.statusText}`);
      }
      
      // 成功保存后退出编辑模式并重新加载数据
      setIsEditMode(false);
      // 重新加载数据
      const loadGalleryData = async () => {
        try {
          setLoading(true);
          setError(null);
          
          const token = getGitHubToken();
        if (!token) throw new Error('No token found');

        // 读取 CONFIG.yml
        const configContent = await fetchGitHubFile(token, owner, repo, 'CONFIG.yml');
        const configData = yaml.load(configContent, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Config;
        setConfig(configData);
        
        // 读取 README.yml
        const readmeContentRaw = await fetchGitHubFile(token, owner, repo, 'README.yml');
        setReadmeContent(readmeContentRaw);
          
          const readmeData = yaml.load(readmeContentRaw, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Record<string, Omit<Album, 'name'>>;
          
          // 转换为数组格式
          const albumsArray = Object.entries(readmeData).map(([name, data]) => ({
            name: name.trim(),
            ...data
          }));
          
          setAlbums(albumsArray);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to reload gallery data');
        } finally {
          setLoading(false);
        }
      };
      
      await loadGalleryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const saveConfigToGitHub = async (content: string) => {
    const token = getGitHubToken();
    if (!token) throw new Error('No token found');
    
    setSavingConfig(true);
    try {
      // 首先获取当前文件的 SHA
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/CONFIG.yml`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get file info: ${response.statusText}`);
      }
      
      const fileData = await response.json();
      
      // 更新文件
      const updateResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/CONFIG.yml`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Update CONFIG.yml via PicG gallery editor',
          content: btoa(unescape(encodeURIComponent(content))), // 正确编码 UTF-8
          sha: fileData.sha
        })
      });
      
      if (!updateResponse.ok) {
        throw new Error(`Failed to update file: ${updateResponse.statusText}`);
      }
      
      // 成功保存后退出编辑模式并重新加载数据
      setIsConfigEditMode(false);
      // 重新加载数据
      const loadGalleryData = async () => {
        try {
          setLoading(true);
          setError(null);
          
          const token = getGitHubToken();
        if (!token) throw new Error('No token found');

        // 读取 CONFIG.yml
        const configContentRaw = await fetchGitHubFile(token, owner, repo, 'CONFIG.yml');
        setConfigContent(configContentRaw);
        
        const configData = yaml.load(configContentRaw, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Config;
        setConfig(configData);
        
        // 读取 README.yml
        const readmeContentRaw = await fetchGitHubFile(token, owner, repo, 'README.yml');
        setReadmeContent(readmeContentRaw); // 保存原始内容用于编辑
        
        const readmeData = yaml.load(readmeContentRaw, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Record<string, Omit<Album, 'name'>>;
          
          // 转换为数组格式
          const albumsArray = Object.entries(readmeData).map(([name, data]) => ({
            name: name.trim(),
            ...data
          }));
          
          setAlbums(albumsArray);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to reload gallery data');
        } finally {
          setLoading(false);
        }
      };
      
      await loadGalleryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config file');
    } finally {
      setSavingConfig(false);
    }
  };

  useEffect(() => {
    const loadGalleryData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const token = getGitHubToken();
        if (!token) throw new Error('No token found');
        
        // 读取 CONFIG.yml
        const configContentRaw = await fetchGitHubFile(token, owner, repo, 'CONFIG.yml');
        setConfigContent(configContentRaw); // 保存原始内容用于编辑
        
        const configData = yaml.load(configContentRaw, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Config;
        setConfig(configData);
        
        // 读取 README.yml
        const readmeContentRaw = await fetchGitHubFile(token, owner, repo, 'README.yml');
        setReadmeContent(readmeContentRaw); // 保存原始内容用于编辑
        
        const readmeData = yaml.load(readmeContentRaw, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Record<string, Omit<Album, 'name'>>;
        
        // 转换为数组格式，确保正确处理 UTF-8 key
        const albumsArray = Object.entries(readmeData).map(([name, data]) => ({
          name: name.trim(), // 去除可能的空白字符
          ...data
        }));
        
        setAlbums(albumsArray);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load gallery data');
      } finally {
        setLoading(false);
      }
    };

    if (owner && repo) {
      loadGalleryData();
    }
  }, [owner, repo]);

  useEffect(() => {
    if (!configContent || !owner || !repo) return;
    let cancelled = false;
    setSummaryStatus((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const cfg = parseGalleryConfig(configContent);
        const token = getGitHubToken();
        if (!token) throw new Error('No token');
        const [db, filledYears] = await Promise.all([
          openGalleryDb(cfg.siteUrl),
          listExistingSummaryYears(token, owner, repo),
        ]);
        if (cancelled) return;
        const yearsWithPhotos = listYearsWithPhotos(db);
        const filledSet = new Set(filledYears);
        const pendingYears = yearsWithPhotos.filter((y) => !filledSet.has(y));
        setSummaryStatus({
          loading: false,
          pendingYears,
          filledYears: yearsWithPhotos.filter((y) => filledSet.has(y)),
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setSummaryStatus({
          loading: false,
          pendingYears: [],
          filledYears: [],
          error: err instanceof Error ? err.message : '加载年度精选状态失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configContent, owner, repo]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">错误: {error}</div>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="container">
      <header className="header">
        <div className="header-content">
          <div className="header-text">
            <h1 className="title">{owner}/{repo}</h1>
            <p className="subtitle">共 {albums.length} 个相册</p>
          </div>
          <div className="edit-buttons">
            <button 
              className="edit-button"
              onClick={() => setIsEditMode(!isEditMode)}
              disabled={saving || savingConfig}
            >
              {isEditMode ? '取消编辑' : '编辑 README.yml'}
            </button>
            <button 
              className="edit-button config"
              onClick={() => setIsConfigEditMode(!isConfigEditMode)}
              disabled={saving || savingConfig}
            >
              {isConfigEditMode ? '取消编辑' : '编辑 CONFIG.yml'}
            </button>
            <button 
              className="edit-button"
              onClick={() => {
                // 跳转到新增相册第一步
                window.location.href = `/gallery/${owner}/${repo}/new-album`;
              }}
              disabled={saving || savingConfig}
            >
              新增相册
            </button>
          </div>
        </div>
      </header>

      {isEditMode || isConfigEditMode ? (
        <div className="edit-container">
          <div className="editor-header">
            <h2>{isEditMode ? '编辑 README.yml' : '编辑 CONFIG.yml'}</h2>
            <p className="editor-subtitle">
              {isEditMode ? '修改相册配置信息' : '修改图片服务器配置'}
            </p>
          </div>
          <textarea
            className="yaml-editor"
            value={isEditMode ? readmeContent : configContent}
            onChange={(e) => {
              if (isEditMode) {
                setReadmeContent(e.target.value);
              } else {
                setConfigContent(e.target.value);
              }
            }}
            placeholder={isEditMode ? "在此编辑 README.yml 内容..." : "在此编辑 CONFIG.yml 内容..."}
            spellCheck={false}
          />
          <div className="editor-actions">
            <button 
              className="submit-button"
              onClick={() => {
                if (isEditMode) {
                  saveReadmeToGitHub(readmeContent);
                } else {
                  saveConfigToGitHub(configContent);
                }
              }}
              disabled={(isEditMode ? saving : savingConfig) || (isEditMode ? !readmeContent.trim() : !configContent.trim())}
            >
              {(isEditMode ? saving : savingConfig) ? '保存中...' : '提交更改'}
            </button>
            <button 
              className="cancel-button"
              onClick={() => {
                if (isEditMode) {
                  setIsEditMode(false);
                } else {
                  setIsConfigEditMode(false);
                }
              }}
              disabled={saving || savingConfig}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
        {(summaryStatus.pendingYears.length > 0 || summaryStatus.loading || summaryStatus.error) && (
          <section className="summary-section">
            <div className="summary-header">
              <h2 className="summary-title">年度精选 · 每月印象</h2>
              <p className="summary-desc">
                为每年挑选每月一张代表照片，主题站会优先使用你选中的图，没填则随机。
              </p>
            </div>
            {summaryStatus.loading && (
              <div className="summary-loading">读取 sqlite.db 中…</div>
            )}
            {summaryStatus.error && !summaryStatus.loading && (
              <div className="summary-error">无法加载年度精选状态：{summaryStatus.error}</div>
            )}
            {!summaryStatus.loading && summaryStatus.pendingYears.length > 0 && (
              <div className="summary-grid">
                {summaryStatus.pendingYears.map((y) => (
                  <Link
                    key={y}
                    href={`/gallery/${owner}/${repo}/annual-summary/${y}`}
                    className="summary-card pending"
                  >
                    <span className="summary-year">{y}</span>
                    <span className="summary-state">待填写 →</span>
                  </Link>
                ))}
                {summaryStatus.filledYears.map((y) => (
                  <Link
                    key={y}
                    href={`/gallery/${owner}/${repo}/annual-summary/${y}`}
                    className="summary-card filled"
                  >
                    <span className="summary-year">{y}</span>
                    <span className="summary-state">已填写 · 编辑</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
        <div className="albums-grid">
        {albums.map((album) => (
          <Link 
            key={album.name} 
            href={`/gallery/${owner}/${repo}/${encodeGitHubPath(album.url)}`} 
            className="album-card"
            style={{
              border: '1px solid color-mix(in srgb, var(--text), transparent 80%)',
              borderRadius: '16px',
              display: 'block',
              textDecoration: 'none',
              color: 'inherit'
            }}
          >
            <div className="album-cover">
              <img 
                src={`${config?.thumbnail_url || config?.backup_thumbnail_url}/${encodeURIComponent(album.cover)}`}
                alt={album.name}
                crossOrigin="anonymous"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const encodedCover = encodeURIComponent(album.cover);
                  
                  // 获取当前文件扩展名并尝试 webp 格式
                  const getWebpVersion = (cover: string) => {
                    const lastDotIndex = cover.lastIndexOf('.');
                    if (lastDotIndex !== -1) {
                      return cover.substring(0, lastDotIndex) + '.webp';
                    }
                    return cover + '.webp';
                  };
                  
                  // 优先级：thumbnail_url -> thumbnail_url(webp) -> backup_thumbnail_url -> backup_thumbnail_url(webp) -> base_url -> backup_base_url
                  if (target.src.includes(config?.thumbnail_url || '') && !target.src.includes('.webp')) {
                    // 尝试 thumbnail_url 的 webp 版本
                    const webpCover = getWebpVersion(album.cover);
                    target.src = `${config?.thumbnail_url}/${encodeURIComponent(webpCover)}`;
                  } else if (target.src.includes(config?.thumbnail_url || '') && target.src.includes('.webp')) {
                    // 尝试 backup_thumbnail_url
                    target.src = `${config?.backup_thumbnail_url}/${encodedCover}`;
                  } else if (target.src.includes(config?.backup_thumbnail_url || '') && !target.src.includes('.webp')) {
                    // 尝试 backup_thumbnail_url 的 webp 版本
                    const webpCover = getWebpVersion(album.cover);
                    target.src = `${config?.backup_thumbnail_url}/${encodeURIComponent(webpCover)}`;
                  } else if (target.src.includes(config?.backup_thumbnail_url || '') && target.src.includes('.webp')) {
                    // 尝试 base_url
                    target.src = `${config?.base_url}/${encodedCover}`;
                  } else if (target.src.includes(config?.base_url || '')) {
                    // 尝试 backup_base_url
                    target.src = `${config?.backup_base_url}/${encodedCover}`;
                  } else {
                    // 所有 URL 都失败，显示占位符
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.placeholder')) {
                      const placeholder = document.createElement('div');
                      placeholder.className = 'placeholder';
                      placeholder.textContent = '图片加载失败';
                      parent.appendChild(placeholder);
                    }
                  }
                }}
              />
            </div>
            <div className="album-info">
              <h3 className="album-name">{album.name}</h3>
              <p className="album-date">{typeof album.date === 'string' ? album.date : new Date(album.date).toLocaleDateString()}</p>
              {album.location && (
                <p className="album-location">
                  📍 {album.location[0].toFixed(4)}, {album.location[1].toFixed(4)}
                </p>
              )}
            </div>
          </Link>
        ))}
        </div>
        </>
      )}

      <style jsx>{`
        .container { width: min(1200px, 94vw); margin: 0 auto; padding: 20px; }
        .loading, .error { 
          text-align: center; 
          padding: 40px; 
          font-size: 18px; 
          color: var(--text-secondary); 
        }
        .error { color: #ef4444; }
        .back-link { 
          color: var(--primary); 
          text-decoration: none; 
          font-weight: 500;
          transition: opacity 0.2s ease;
        }
        .back-link:hover { opacity: 0.8; }
        .header { 
          margin-bottom: 32px; 
          border-bottom: 1px solid var(--border);
          padding-bottom: 20px;
        }
        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 20px;
        }
        .header-text {
          flex: 1;
        }
        .edit-buttons {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .edit-button {
          background: var(--primary);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }
        .edit-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        .edit-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }


        .title { 
          font-size: 28px; 
          font-weight: 700; 
          margin: 12px 0 8px; 
          color: var(--text);
        }
        .subtitle { 
          color: var(--text-secondary); 
          margin: 0; 
        }
        .albums-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); 
          gap: 20px; 
        }
        .album-card { 
          background: var(--surface); 
          overflow: hidden; 
          box-shadow: 0 2px 8px color-mix(in srgb, var(--text), transparent 92%);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          position: relative;
        }
        .album-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, color-mix(in srgb, var(--primary), transparent 95%) 0%, transparent 50%);
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
        }
        .album-card:hover { 
          transform: translateY(-4px); 
          box-shadow: 0 8px 25px color-mix(in srgb, var(--text), transparent 85%);
          border-color: color-mix(in srgb, var(--primary), transparent 60%);
        }
        .album-card:hover::before {
          opacity: 1;
        }
        .album-cover { 
          aspect-ratio: 16/10; 
          overflow: hidden; 
          background: var(--border);
          position: relative;
          border-radius: 15px 15px 0 0;
        }
        .album-cover img { 
          width: 100%; 
          height: 100%; 
          object-fit: cover; 
          transition: transform 0.3s ease;
        }
        .placeholder {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: var(--text-secondary);
          font-size: 14px;
          text-align: center;
          background: var(--surface);
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
        }
        .album-card:hover .album-cover img { 
          transform: scale(1.05); 
        }
        .album-info { 
          padding: 16px;
          position: relative;
          z-index: 1;
        }
        .album-name { 
          font-size: 16px; 
          font-weight: 700; 
          margin: 0 0 4px; 
          color: var(--text);
          line-height: 1.4;
        }
        .album-date { 
          color: var(--text-secondary); 
          font-size: 14px; 
          margin: 0 0 4px; 
        }
        .album-location { 
          color: var(--text-secondary); 
          font-size: 12px; 
          margin: 0; 
        }
        .edit-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
        }
        .editor-header {
          margin-bottom: 20px;
        }
        .editor-header h2 {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 4px;
          color: var(--text);
        }
        .editor-subtitle {
          color: var(--text-secondary);
          font-size: 14px;
          margin: 0;
        }
        .yaml-editor {
          width: 100%;
          min-height: 400px;
          padding: 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--input);
          color: var(--text);
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 1.5;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s ease;
        }
        .yaml-editor:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary), transparent 90%);
        }
        .editor-actions {
          display: flex;
          gap: 12px;
          margin-top: 16px;
          justify-content: flex-end;
        }
        .submit-button {
          background: var(--primary);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .submit-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        .submit-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .cancel-button {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border);
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .cancel-button:hover:not(:disabled) {
          background: var(--border);
          color: var(--text);
        }
        .cancel-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .summary-section {
          margin-bottom: 28px;
          padding: 20px;
          border: 1px solid color-mix(in srgb, var(--text), transparent 88%);
          border-radius: 16px;
          background: color-mix(in srgb, var(--surface), transparent 30%);
        }
        .summary-header { margin-bottom: 12px; }
        .summary-title { font-size: 18px; font-weight: 700; margin: 0 0 4px; color: var(--text); }
        .summary-desc { color: var(--text-secondary); font-size: 13px; margin: 0; }
        .summary-loading, .summary-error {
          font-size: 13px;
          color: var(--text-secondary);
          padding: 8px 0;
        }
        .summary-error { color: #ef4444; }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .summary-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-radius: 10px;
          text-decoration: none;
          font-size: 14px;
          transition: all 0.2s ease;
          border: 1px solid transparent;
        }
        .summary-card.pending {
          background: color-mix(in srgb, var(--primary), transparent 88%);
          color: var(--primary);
          border-color: color-mix(in srgb, var(--primary), transparent 60%);
        }
        .summary-card.pending:hover {
          background: color-mix(in srgb, var(--primary), transparent 75%);
          transform: translateY(-1px);
        }
        .summary-card.filled {
          background: var(--surface);
          color: var(--text-secondary);
          border-color: var(--border);
        }
        .summary-card.filled:hover {
          color: var(--text);
          border-color: color-mix(in srgb, var(--text), transparent 70%);
        }
        .summary-year { font-weight: 700; font-size: 16px; }
        .summary-state { font-size: 12px; }
      `}</style>
      </div>
    </AuthGuard>
  );
}