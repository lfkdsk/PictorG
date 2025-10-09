'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createRepo, listRepos, type Repo } from '@/lib/github';

type Gallery = {
  id: number;
  full_name: string;
  html_url: string;
};

const GALLERIES_KEY = 'pictor_galleries';
const REPOS_CACHE_KEY = 'pictor_repos_cache';

function readToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )gh_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch { }
  try {
    return localStorage.getItem('gh_token');
  } catch { }
  return null;
}

function saveToCache(key: string, data: any) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save to cache:', error);
  }
}

function loadFromCache(key: string) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    return JSON.parse(cached);
  } catch (error) {
    console.warn('Failed to load from cache:', error);
    return null;
  }
}

export default function GalleryManager() {
  const [token, setToken] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [q, setQ] = useState('');
  const [repoQuery, setRepoQuery] = useState('');

  // Modals
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setToken(readToken());
    // 加载画廊缓存
    const cachedGalleries = loadFromCache(GALLERIES_KEY);
    if (cachedGalleries && Array.isArray(cachedGalleries)) {
      setGalleries(cachedGalleries);
    }
    // 加载仓库缓存
    const cachedRepos = loadFromCache(REPOS_CACHE_KEY);
    if (cachedRepos && Array.isArray(cachedRepos)) {
      setRepos(cachedRepos);
    }
  }, []);

  useEffect(() => {
    if (galleries.length > 0) {
      saveToCache(GALLERIES_KEY, galleries);
    }
  }, [galleries]);

  useEffect(() => {
    if (repos && repos.length > 0) {
      saveToCache(REPOS_CACHE_KEY, repos);
    }
  }, [repos]);

  const loadRepos = async () => {
    if (!token) return;

    // 优先使用内存中的数据
    if (repos && repos.length > 0) return;

    // 检查缓存
    const cachedRepos = loadFromCache(REPOS_CACHE_KEY);
    if (cachedRepos && Array.isArray(cachedRepos) && cachedRepos.length > 0) {
      setRepos(cachedRepos);
      return;
    }

    // 从网络加载
    setLoadingRepos(true);
    setError(null);
    try {
      const data = await listRepos(token);
      setRepos(data);
      saveToCache(REPOS_CACHE_KEY, data);
    } catch (e: any) {
      setError(e?.message ?? '加载仓库失败');
    } finally {
      setLoadingRepos(false);
    }
  };

  const repoOptions = useMemo(() => repos?.map((r) => ({ value: r.full_name, id: r.id })) ?? [], [repos]);
  const filteredRepos = useMemo(
    () => repoOptions.filter((o) => o.value.toLowerCase().includes(repoQuery.trim().toLowerCase())),
    [repoOptions, repoQuery]
  );
  const filteredGalleries = useMemo(
    () => galleries.filter((g) => g.full_name.toLowerCase().includes(q.trim().toLowerCase())),
    [galleries, q]
  );

  const importSelected = () => {
    const repo = repos?.find((r) => r.full_name === selectedRepo);
    if (!repo) return;
    const item: Gallery = { id: repo.id, full_name: repo.full_name, html_url: repo.html_url };
    setGalleries((prev) => (prev.some((g) => g.id === item.id) ? prev : [item, ...prev]));
    setShowImport(false);
    setSelectedRepo('');
  };

  const createNew = async () => {
    if (!token || !newRepoName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const repo = await createRepo(token, newRepoName.trim(), newRepoPrivate);
      setGalleries((prev) => (prev.some((g) => g.id === repo.id) ? prev : [{ id: repo.id, full_name: repo.full_name, html_url: repo.html_url }, ...prev]));
      setShowCreate(false);
      setNewRepoName('');
      setNewRepoPrivate(false);
      // update cached repos list as well
      setRepos((prev) => (prev ? [repo, ...prev] : [repo]));
    } catch (e: any) {
      setError(e?.message ?? '新建仓库失败');
    } finally {
      setCreating(false);
    }
  };

  const removeGallery = (id: number) => {
    // 获取要移除的仓库信息
    const galleryToRemove = galleries.find(g => g.id === id);

    if (!galleryToRemove) return;

    // 从状态中移除
    setGalleries((prev) => {
      const newGalleries = prev.filter((g) => g.id !== id);
      // 如果是最后一个仓库，确保更新缓存
      if (newGalleries.length === 0) {
        localStorage.removeItem(GALLERIES_KEY);
      }
      return newGalleries;
    });

    // 清理相关缓存（静默清理）
    clearGalleryCache(galleryToRemove.full_name, true);
  };

  const clearGalleryCache = (repoFullName: string, silent: boolean = false) => {
    try {
      // 清理仓库相关的所有缓存
      const [owner, repo] = repoFullName.split('/');

      // 清理localStorage中所有相关的键
      const localStorageKeys = Object.keys(localStorage);
      let clearedCount = 0;

      localStorageKeys.forEach(key => {
        // 清理包含仓库信息的缓存
        if (key.includes(owner) && key.includes(repo)) {
          localStorage.removeItem(key);
          clearedCount++;
          if (!silent) console.log(`清理localStorage键: ${key}`);
        }
        // 清理特定模式的缓存
        if (key.includes(`${owner}_${repo}`) ||
          key.includes(`${owner}/${repo}`) ||
          key.includes(repoFullName)) {
          localStorage.removeItem(key);
          clearedCount++;
          if (!silent) console.log(`清理localStorage键: ${key}`);
        }
      });

      // 清理sessionStorage中所有相关的键
      const sessionStorageKeys = Object.keys(sessionStorage);
      sessionStorageKeys.forEach(key => {
        // 清理包含仓库信息的缓存
        if (key.includes(owner) && key.includes(repo)) {
          sessionStorage.removeItem(key);
          clearedCount++;
          if (!silent) console.log(`清理sessionStorage键: ${key}`);
        }
        // 清理特定模式的缓存
        if (key.includes(`${owner}_${repo}`) ||
          key.includes(`${owner}/${repo}`) ||
          key.includes(repoFullName)) {
          sessionStorage.removeItem(key);
          clearedCount++;
          if (!silent) console.log(`清理sessionStorage键: ${key}`);
        }
      });

      // 强制清理已知的缓存键
      const knownCacheKeys = [
        'newAlbumForm',
        'uploadedFiles',
        `gallery_${owner}_${repo}`,
        `albums_${owner}_${repo}`,
        `config_${owner}_${repo}`,
        `readme_${owner}_${repo}`,
        `images_${owner}_${repo}`,
        `upload_${owner}_${repo}`,
        `${owner}/${repo}_cache`,
        `${repoFullName}_cache`
      ];

      knownCacheKeys.forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });

      // 清理浏览器缓存（如果支持）
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => {
            if (name.includes(owner) || name.includes(repo) || name.includes(repoFullName)) {
              caches.delete(name);
              if (!silent) console.log(`清理浏览器缓存: ${name}`);
            }
          });
        });
      }

      if (!silent) {
        console.log(`✅ 已清理仓库 ${repoFullName} 的所有相关缓存`);
      }
    } catch (error) {
      console.warn('清理缓存时出错:', error);
    }
  };



  return (
    <section className="wrap">
      <header className="head">
        <input
          className="search"
          placeholder="搜索画廊…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="search galleries"
        />
        <div className="toolbar">
          <button className="btn outline" onClick={() => { setShowImport(true); loadRepos(); }}>
            导入
          </button>
          <Link href="/create-gallery" className="link"
            style={{
              height: '36px',
              padding: '0 12px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: '500',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              transition: 'all 0.2s ease'
            }}>
            创建画廊
          </Link>
        </div>
      </header>

      {!token ? (
        <p className="dim">
          未检测到 Token，请先前往 <a
            href="/login/token"
            className="link"
            style={{
              color: 'var(--primary)',
              textDecoration: 'none',
              fontWeight: '500',
              padding: '2px 4px',
              borderRadius: '4px',
              transition: 'all 0.2s ease'
            }}
          >
            设置 Token
          </a>
        </p>
      ) : null}

      <section className="grid">
        {galleries.length === 0 ? (
          <p className="dim">暂无画廊，请点击右上角“导入”或“新建”</p>
        ) : (
          filteredGalleries.map((g) => {
            const [owner, repo] = g.full_name.split('/');
            return (
              <div key={g.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="card-content">
                  <div className="name">{g.full_name}</div>
                </div>
                <div className="url" style={{ marginTop: '12px', width: '100%' }}>
                  <a 
                    href={`https://${owner}.github.io/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                      textDecoration: 'none',
                      display: 'block',
                      padding: '6px 8px',
                      backgroundColor: 'var(--surface)',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      width: '100%',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--surface)';
                    }}
                  >
                    🌐 {owner}.github.io/{repo}
                  </a>
                </div>

                <div className="actions">
                  <Link
                    href={`/gallery/${owner}/${repo}`}
                    className="link"
                    style={{
                      height: '32px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'var(--primary)',
                      color: '#fff',
                      fontWeight: '500',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    打开
                  </Link>
                  <button className="danger" onClick={() => removeGallery(g.id)}>移除</button>
                </div>
              </div>
            );
          })
        )}
      </section>

      {showImport ? (
        <div className="modal" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.45)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 1000
        }}>
          <div className="dialog" style={{
            width: 'min(520px, 92vw)',
            background: 'var(--surface)',
            borderRadius: '12px',
            padding: '16px',
            display: 'grid',
            gap: '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <h3 className="dlg-title">导入画廊</h3>
            <label className="label">选择仓库</label>
            <input
              className="input"
              placeholder={loadingRepos ? '加载中…' : '搜索仓库…'}
              value={repoQuery}
              onChange={(e) => { setRepoQuery(e.target.value); setSelectedRepo(''); }}
            />
            {filteredRepos.length > 0 ? (
              <div className="results">
                {filteredRepos.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    className={`result ${selectedRepo === o.value ? 'active' : ''}`}
                    onClick={() => setSelectedRepo(o.value)}
                    title={o.value}
                  >
                    {o.value}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="dlg-actions">
              <button className="btn outline" onClick={() => setShowImport(false)}>取消</button>
              <button
                className="btn"
                onClick={importSelected}
                disabled={!selectedRepo || !repoOptions.some((o) => o.value === selectedRepo)}
                title={!selectedRepo || !repoOptions.some((o) => o.value === selectedRepo) ? '请选择列表中的仓库' : '导入'}
              >
                导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div className="modal">
          <div className="dialog">
            <h3 className="dlg-title">新建画廊</h3>
            <label className="label">画廊名称</label>
            <input className="input" value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="输入名称" />
            <div className="radio-row">
              <span>可见性</span>
              <label><input type="radio" name="vis" checked={!newRepoPrivate} onChange={() => setNewRepoPrivate(false)} /> 公开</label>
              <label><input type="radio" name="vis" checked={newRepoPrivate} onChange={() => setNewRepoPrivate(true)} /> 私有</label>
            </div>
            <p className="note">*私有画廊仅支持 GitHub 付费用户</p>
            <div className="dlg-actions">
              <button className="btn outline" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn" onClick={createNew} disabled={!newRepoName.trim() || creating}>{creating ? '新建中…' : '新建'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="error">{error}</p> : null}

      <style jsx>{`
        /* Styled JSX Test - This should apply styles */
        .wrap { width: min(980px, 92vw); margin: 0 auto; display: grid; gap: 16px; }
        .head { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; }
        .toolbar { display: grid; grid-auto-flow: column; gap: 10px; }
        .search { height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--input); padding: 0 10px; }
        .toolbar .btn { 
          height: 36px; 
          padding: 0 12px; 
          border-radius: 10px; 
          border: none; 
          background: var(--primary); 
          color: #fff; 
          font-weight: 600; 
          cursor: pointer; 
          transition: all 0.2s ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
        .toolbar a.btn {
          height: 36px; 
          padding: 0 12px; 
          border-radius: 10px; 
          border: none; 
          background: var(--primary); 
          color: #fff; 
          font-weight: 600; 
          cursor: pointer; 
          transition: all 0.2s ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
        .toolbar a.btn:link,
        .toolbar a.btn:visited {
          color: #fff;
          text-decoration: none;
        }
        .toolbar .btn:hover { transform: translateY(-1px); }
        .toolbar .btn.outline { background: transparent; color: inherit; border: 2px solid var(--border); }
        .toolbar .btn.outline:hover { background: color-mix(in srgb, var(--border), transparent 90%); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .card { 
          background: var(--surface); 
          border-radius: 16px; 
          padding: 20px; 
          display: flex; 
          align-items: center;
          justify-content: space-between;
          gap: 16px; 
          border: 1px solid color-mix(in srgb, var(--border), transparent 50%);
          box-shadow: 0 2px 8px color-mix(in srgb, var(--text), transparent 92%);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          cursor: pointer;
        }
        .card-content {
          flex: 1;
          min-width: 0;
        }
        .card::before {
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
        .card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 25px color-mix(in srgb, var(--text), transparent 85%);
          border-color: color-mix(in srgb, var(--primary), transparent 70%);
        }
        .card:hover::before {
          opacity: 1;
        }
        .name { 
          font-weight: 700; 
          font-size: 16px; 
          color: var(--text);
          margin-bottom: 4px;
          line-height: 1.4;
        }
        .actions { 
          display: flex; 
          gap: 8px; 
          align-items: center; 
          flex-shrink: 0;
        }
        .link { 
          height: 36px !important; 
          padding: 0 12px !important; 
          border-radius: 10px !important; 
          border: none !important; 
          background: var(--primary) !important; 
          font-weight: 600 !important; 
          cursor: pointer !important; 
          transition: all 0.2s ease !important;
          text-decoration: none !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 14px !important;
          box-sizing: border-box !important;
        }
        .link:hover {
          transform: translateY(-1px) !important;
          background: color-mix(in srgb, var(--primary), black 10%) !important;
        }
        .danger { 
          background: #ef4444; 
          color: #fff; 
          border: none; 
          border-radius: 8px; 
          height: 32px; 
          padding: 0 12px; 
          cursor: pointer; 
          font-weight: 500;
          font-size: 14px;
          transition: all 0.2s ease;
        }
        .danger:hover {
          background: #dc2626;
          transform: translateY(-1px);
        }
        .dim { opacity: .85; }
        .error { color: #dc2626; text-align: center; }
        .modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; }
        .dialog { width: min(520px, 92vw); background: var(--surface); border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
        .dlg-title { margin: 4px 0 8px; font-size: 18px; }
        .label { font-size: 14px; }
        .input, .select { height: 40px; border-radius: 10px; border: 1px solid var(--border); background: var(--input); padding: 0 10px; }
        .results { max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 4px; display: grid; gap: 4px; }
        .result { text-align: left; height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .result:hover { background: color-mix(in srgb, var(--primary), transparent 90%); }
        .result.active { border-color: var(--primary); background: color-mix(in srgb, var(--primary), transparent 85%); }
        .radio-row { display: grid; grid-auto-flow: column; gap: 12px; align-items: center; }
        .note { font-size: 12px; opacity: .8; }
        .dlg-actions { display: grid; grid-auto-flow: column; gap: 10px; justify-content: end; }
        @media (max-width: 640px) { .radio-row { grid-auto-flow: row; } }
      `}</style>
    </section>
  );
}
