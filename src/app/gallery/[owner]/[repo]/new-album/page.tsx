'use client';
import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getExistingAlbumUrls, getGitHubToken } from '@/lib/github';

interface AlbumForm {
  name: string;
  url: string;
  date: string;
  style: string;
  location: string;
}

export default function NewAlbumPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const [form, setForm] = useState<AlbumForm>({
    name: '',
    url: '',
    date: new Date().toISOString().split('T')[0],
    style: 'fullscreen',
    location: ''
  });

  // 从sessionStorage恢复表单数据
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('newAlbumForm');
      if (saved) {
        const savedForm = JSON.parse(saved);
        setForm(savedForm);
      }
    } catch (error) {
      console.error('Failed to load saved form:', error);
    }
  }, []);

  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  const [urlError, setUrlError] = useState('');
  const [loadingUrls, setLoadingUrls] = useState(false);

  // 加载现有的相册URL
  useEffect(() => {
    const loadExistingUrls = async () => {
      const token = getGitHubToken();
      if (!token) return;
      
      setLoadingUrls(true);
      try {
        const urls = await getExistingAlbumUrls(token, owner, repo);
        setExistingUrls(urls);
      } catch (error) {
        console.error('Failed to load existing URLs:', error);
      } finally {
        setLoadingUrls(false);
      }
    };

    if (owner && repo) {
      loadExistingUrls();
    }
  }, [owner, repo]);

  // 检查URL重复
  useEffect(() => {
    if (form.url) {
      const isDuplicate = existingUrls.includes(form.url);
      setUrlError(isDuplicate ? '该URL已存在，请使用其他名称' : '');
    } else {
      setUrlError('');
    }
  }, [form.url, existingUrls]);

  // 实时保存表单数据
  const updateForm = (updates: Partial<AlbumForm>) => {
    const newForm = { ...form, ...updates };
    setForm(newForm);
    // 实时保存到sessionStorage
    sessionStorage.setItem('newAlbumForm', JSON.stringify(newForm));
  };

  const handleNext = () => {
    if (!form.name.trim()) {
      alert('请填写相册名称');
      return;
    }
    if (!form.url.trim()) {
      alert('请填写相册URL');
      return;
    }
    if (urlError) {
      alert('请解决URL重复问题');
      return;
    }

    // 跳转到第二步：上传图片
    window.location.href = `/gallery/${owner}/${repo}/new-album/upload`;
  };

  return (
    <div className="new-album-container">
      {/* 顶部导航 */}
      <div className="top-nav">
        <Link 
          href={`/gallery/${owner}/${repo}`}
          style={{
            color: 'var(--primary)',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: '500',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'color-mix(in srgb, var(--primary), transparent 90%)',
            border: '1px solid color-mix(in srgb, var(--primary), transparent 70%)',
            transition: 'all 0.2s ease',
            width: 'fit-content'
          }}
        >
          <span style={{ fontSize: '16px', fontWeight: 'bold' }}>←</span>
          <span>返回相册列表</span>
        </Link>
        
        <div className="nav-title">
          <h1>新增相册 - 步骤 1/3</h1>
          <p>填写相册基本信息</p>
        </div>
      </div>

      {/* 表单内容 */}
      <div className="form-container">
        <div className="form-section">
          <h2>相册信息</h2>
          
          <div className="form-group">
            <label>相册名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value })}
              placeholder="例如：Ruby Lake Trail"
              required
            />
          </div>

          <div className="form-group">
            <label>相册URL *</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => updateForm({ url: e.target.value })}
              placeholder="例如：RubyLakeTrail"
              required
            />
            {loadingUrls && <div className="info-text">正在检查URL是否可用...</div>}
            {urlError && <div className="error-text">{urlError}</div>}
            {!loadingUrls && form.url && !urlError && <div className="success-text">✅ URL可用</div>}
            <div className="help-text">URL将用作文件夹名称，建议使用英文</div>
          </div>

          <div className="form-group">
            <label>拍摄日期 *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateForm({ date: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>显示样式 *</label>
            <select
              value={form.style}
              onChange={(e) => updateForm({ style: e.target.value })}
              required
            >
              <option value="fullscreen">全屏显示</option>
              <option value="default">默认显示</option>
            </select>
          </div>

          <div className="form-group">
            <label>地理位置（可选）</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => updateForm({ location: e.target.value })}
              placeholder="例如：37.41588277200025, -118.7716685680481"
            />
            <div className="help-text">格式：纬度, 经度（可以从地图应用复制）</div>
          </div>
        </div>

        <div className="form-actions">
          <button 
            className="next-btn"
            onClick={handleNext}
          >
            下一步：上传图片 →
          </button>
        </div>
      </div>

      <style jsx>{`
        .new-album-container {
          min-height: 100vh;
          background: var(--bg);
          color: var(--text);
          display: flex;
          flex-direction: column;
        }
        
        .top-nav {
          background: var(--bg);
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 24px;
        }
        
        .nav-title h1 {
          font-size: 20px;
          font-weight: 600;
          margin: 0;
          color: var(--text);
        }
        
        .nav-title p {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 4px 0 0;
        }
        
        .form-container {
          flex: 1;
          width: 90%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 24px;
        }
        
        .form-section {
          background: var(--surface);
          border-radius: 12px;
          padding: 32px 40px;
          border: 1px solid var(--border);
          margin-bottom: 24px;
          width: 100%;
        }
        
        .form-section h2 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 20px;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group:last-child {
          margin-bottom: 0;
        }
        
        .form-group label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 6px;
        }
        
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--input);
          color: var(--text);
          font-size: 14px;
          transition: border-color 0.2s ease;
        }
        
        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary), transparent 90%);
        }
        
        .help-text {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        
        .error-text {
          font-size: 12px;
          color: #ef4444;
          margin-top: 4px;
        }
        
        .success-text {
          font-size: 12px;
          color: #10b981;
          margin-top: 4px;
        }
        
        .info-text {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        
        .form-actions {
          display: flex;
          justify-content: flex-end;
        }
        
        .next-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .next-btn:hover {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  );
}