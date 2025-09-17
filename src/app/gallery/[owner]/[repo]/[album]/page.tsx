'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import yaml from 'js-yaml';
import { fetchGitHubFile, updateGitHubFile, getFileSha, getGitHubToken } from '@/lib/github';

type Config = {
  thumbnail_url: string;
  base_url: string;
  backup_base_url: string;
  backup_thumbnail_url: string;
};

type AlbumInfo = {
  name: string;
  url: string;
  date: string | Date;
  style: string;
  cover: string;
  location?: [number, number];
};

type ImageFile = {
  name: string;
  path: string;
  size: number;
  download_url: string;
};



export default function AlbumPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;
  const albumUrl = params.album as string;
  
  const [config, setConfig] = useState<Config | null>(null);
  const [albumInfo, setAlbumInfo] = useState<AlbumInfo | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    url: '',
    date: '',
    style: '',
    cover: '',
    location: [0, 0] as [number, number]
  });
  const [saving, setSaving] = useState(false);

  const fetchDirectoryContents = async (path: string): Promise<ImageFile[]> => {
    const token = getGitHubToken();
    if (!token) throw new Error('No token found');
    
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch directory ${path}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 过滤出图片文件
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    return data
      .filter((file: any) => 
        file.type === 'file' && 
        imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
      )
      .map((file: any) => ({
        name: file.name,
        path: file.path,
        size: file.size,
        download_url: file.download_url
      }));
  };

  useEffect(() => {
    const loadAlbumData = async () => {
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
        const readmeContent = await fetchGitHubFile(token, owner, repo, 'README.yml');
      const readmeData = yaml.load(readmeContent, { 
        schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
        json: true 
      }) as Record<string, Omit<AlbumInfo, 'name'>>;
        
        // 找到当前相册的信息
        const albumEntry = Object.entries(readmeData).find(([name, data]) => data.url === albumUrl);
        if (!albumEntry) {
          throw new Error('Album not found');
        }
        
        const [albumName, albumData] = albumEntry;
        setAlbumInfo({
          name: albumName.trim(),
          ...albumData
        });
        
        // 读取相册文件夹中的图片
        const imageFiles = await fetchDirectoryContents(albumUrl);
        setImages(imageFiles);
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load album data');
      } finally {
        setLoading(false);
      }
    };

    if (owner && repo && albumUrl) {
      loadAlbumData();
    }
  }, [owner, repo, albumUrl]);

  const getImageUrl = (imageName: string, useThumbnail = true) => {
    if (!config) return '';
    
    const encodedName = encodeURIComponent(imageName);
    const baseUrl = useThumbnail 
      ? (config.thumbnail_url || config.backup_thumbnail_url)
      : (config.base_url || config.backup_base_url);
    
    return `${baseUrl}/${albumUrl}/${encodedName}`;
  };

  const deleteSelectedImages = async () => {
    const token = getGitHubToken();
    if (!token) throw new Error('No token found');
    
    setDeleting(true);
    try {
      const deletePromises = Array.from(selectedImages).map(async (imageName) => {
        // 获取文件信息以获取SHA
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${albumUrl}/${imageName}`, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to get file info for ${imageName}: ${response.statusText}`);
        }
        
        const fileData = await response.json();
        
        // 删除文件
        const deleteResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${albumUrl}/${imageName}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `Delete image ${imageName} from ${albumUrl}`,
            sha: fileData.sha
          })
        });
        
        if (!deleteResponse.ok) {
          throw new Error(`Failed to delete ${imageName}: ${deleteResponse.statusText}`);
        }
        
        return imageName;
      });
      
      await Promise.all(deletePromises);
      
      // 重新加载图片列表
      const imageFiles = await fetchDirectoryContents(albumUrl);
      setImages(imageFiles);
      
      // 清空选择并退出删除模式
      setSelectedImages(new Set());
      setIsDeleteMode(false);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete images');
    } finally {
      setDeleting(false);
    }
  };

  const toggleImageSelection = (imageName: string) => {
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageName)) {
      newSelected.delete(imageName);
    } else {
      newSelected.add(imageName);
    }
    setSelectedImages(newSelected);
  };

  const openEditModal = () => {
    if (albumInfo) {
      setEditForm({
        name: albumInfo.name,
        url: albumInfo.url,
        date: typeof albumInfo.date === 'string' ? albumInfo.date : new Date(albumInfo.date).toISOString().split('T')[0],
        style: albumInfo.style,
        cover: albumInfo.cover,
        location: albumInfo.location || [0, 0]
      });
      setShowEditModal(true);
    }
  };

  const saveAlbumInfo = async () => {
    const token = getGitHubToken();
    if (!token) throw new Error('No token found');
    
    // 基本验证
    if (!editForm.name.trim()) {
      setError('相册名称不能为空');
      return;
    }
    if (!editForm.url.trim()) {
      setError('URL路径不能为空');
      return;
    }
    if (!editForm.date) {
      setError('日期不能为空');
      return;
    }
    if (!editForm.style) {
      setError('样式不能为空');
      return;
    }
    if (!editForm.cover.trim()) {
      setError('封面图片不能为空');
      return;
    }
    
    setSaving(true);
    try {
      // 读取当前的README.yml
      const readmeContent = await fetchGitHubFile(token, owner, repo, 'README.yml');
      const readmeData = yaml.load(readmeContent, { 
        schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
        json: true 
      }) as Record<string, Omit<AlbumInfo, 'name'>>;
      
      // 删除旧的相册条目（如果名称改变了）
      if (albumInfo && editForm.name !== albumInfo.name) {
        delete readmeData[albumInfo.name];
      }
      
      // 更新相册信息
      const albumData: any = {
        url: editForm.url,
        date: editForm.date, // 保持字符串格式，YAML会正确处理
        style: editForm.style,
        cover: editForm.cover
      };
      
      // 只有当经纬度都不为空且不为0时才添加location
      if (editForm.location[0] !== 0 && editForm.location[1] !== 0) {
        albumData.location = [editForm.location[0], editForm.location[1]]; // 确保是数组格式
      }
      
      readmeData[editForm.name] = albumData;
      
      // 转换回YAML格式，确保正确的数组和字符串格式
      const updatedYaml = yaml.dump(readmeData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false
      });
      
      // 获取文件SHA
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
          message: `Update album info for ${editForm.name}`,
          content: btoa(unescape(encodeURIComponent(updatedYaml))),
          sha: fileData.sha
        })
      });
      
      if (!updateResponse.ok) {
        throw new Error(`Failed to update file: ${updateResponse.statusText}`);
      }
      
      // 关闭弹窗并重新加载数据
      setShowEditModal(false);
      window.location.reload();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save album info');
    } finally {
      setSaving(false);
    }
  };

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
    <div className="album-container">
      {/* 左侧相册信息面板 */}
      <aside className="album-sidebar">
        <div className="album-header">
          <Link 
            href={`/gallery/${owner}/${repo}`} 
            className="back-btn"
            style={{
              color: 'var(--primary)',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '16px',
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
          <div className="title-row">
            <h1 className="album-title">{albumInfo?.name}</h1>
            <button 
              className="edit-album-btn"
              onClick={openEditModal}
              disabled={deleting || saving}
            >
              ✏️ 编辑
            </button>
          </div>
        </div>
        
        <div className="album-details">
          <div className="detail-item">
            <span className="label">日期:</span>
            <span className="value">
              {typeof albumInfo?.date === 'string' 
                ? albumInfo.date 
                : new Date(albumInfo?.date || '').toLocaleDateString()}
            </span>
          </div>
          
          <div className="detail-item">
            <span className="label">样式:</span>
            <span className="value">{albumInfo?.style}</span>
          </div>
          
          {albumInfo?.location && (
            <div className="detail-item">
              <span className="label">位置:</span>
              <span className="value">
                📍 {albumInfo.location[0].toFixed(4)}, {albumInfo.location[1].toFixed(4)}
              </span>
            </div>
          )}
          
          <div className="detail-item">
            <span className="label">图片数量:</span>
            <span className="value">{images.length} 张</span>
          </div>
          
          <div className="detail-item">
            <span className="label">总大小:</span>
            <span className="value">
              {(images.reduce((sum, img) => sum + img.size, 0) / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
        </div>
        
        <div className="album-controls">
          <button 
            className="upload-btn"
            onClick={() => {
              // 跳转到上传页面
              window.location.href = `/gallery/${owner}/${repo}/${albumUrl}/upload`;
            }}
            disabled={deleting || saving}
          >
            📤 上传图片
          </button>
          
          <button 
            className="delete-mode-btn"
            onClick={() => {
              setIsDeleteMode(!isDeleteMode);
              setSelectedImages(new Set());
            }}
            disabled={deleting}
          >
            {isDeleteMode ? '取消删除' : '删除图片'}
          </button>
          
          {isDeleteMode && (
            <div className="delete-actions">
              <p className="selected-count">
                已选择 {selectedImages.size} 张图片
              </p>
              <button 
                className="delete-confirm-btn"
                onClick={deleteSelectedImages}
                disabled={selectedImages.size === 0 || deleting}
              >
                {deleting ? '删除中...' : `删除选中的图片 (${selectedImages.size})`}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 右侧图片网格 */}
      <main className="album-content">
        <div className="images-grid">
          {images.map((image) => (
            <div 
              key={image.name} 
              className={`image-card ${isDeleteMode ? 'delete-mode' : ''} ${selectedImages.has(image.name) ? 'selected' : ''}`}
            >
              {isDeleteMode && (
                <div 
                  className={`select-overlay ${selectedImages.has(image.name) ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleImageSelection(image.name);
                  }}
                >
                  {selectedImages.has(image.name) && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path 
                        d="M20 6L9 17L4 12" 
                        stroke="white" 
                        strokeWidth="3" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              )}
              <div 
                className="image-wrapper"
                onClick={() => {
                  if (isDeleteMode) {
                    toggleImageSelection(image.name);
                  } else {
                    // 点击图片查看大图
                    window.open(getImageUrl(image.name, false), '_blank');
                  }
                }}
              >
                <img
                  src={getImageUrl(image.name, true)}
                  alt={image.name}
                  crossOrigin="anonymous"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    // 如果缩略图失败，尝试原图
                    if (target.src.includes('thumbnail')) {
                      target.src = getImageUrl(image.name, false);
                    }
                  }}
                />
              </div>
              <div className="image-info">
                <div className="image-name">{image.name}</div>
                <div className="image-size">{(image.size / 1024).toFixed(1)} KB</div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* 编辑弹窗 */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>编辑相册信息</h2>
              <button 
                className="close-btn"
                onClick={() => setShowEditModal(false)}
              >
                ✕
              </button>
            </div>
            
            <form className="edit-form" onSubmit={(e) => { e.preventDefault(); saveAlbumInfo(); }}>
              <div className="form-group">
                <label>相册名称</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>URL路径</label>
                <input
                  type="text"
                  value={editForm.url}
                  onChange={(e) => setEditForm({...editForm, url: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>日期</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>样式</label>
                <select
                  value={editForm.style}
                  onChange={(e) => setEditForm({...editForm, style: e.target.value})}
                  required
                >
                  <option value="">选择样式</option>
                  <option value="fullscreen">全屏</option>
                  <option value="default">默认</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>封面图片</label>
                <input
                  type="text"
                  value={editForm.cover}
                  onChange={(e) => setEditForm({...editForm, cover: e.target.value})}
                  placeholder="相对路径，如: RubyLakeTrail/IMG_3363.webp"
                  required
                />
              </div>
              
              <div className="form-row">
                 <div className="form-group">
                   <label>纬度 (可选)</label>
                   <input
                     type="number"
                     step="any"
                     value={editForm.location[0] || ''}
                     onChange={(e) => setEditForm({...editForm, location: [parseFloat(e.target.value) || 0, editForm.location[1]]})}
                     placeholder="如: 37.4159"
                   />
                 </div>
                 
                 <div className="form-group">
                   <label>经度 (可选)</label>
                   <input
                     type="number"
                     step="any"
                     value={editForm.location[1] || ''}
                     onChange={(e) => setEditForm({...editForm, location: [editForm.location[0], parseFloat(e.target.value) || 0]})}
                     placeholder="如: -118.7717"
                   />
                 </div>
               </div>
              
              <div className="form-actions">
                <button 
                  type="button"
                  className="cancel-btn"
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="save-btn"
                  disabled={saving || !editForm.name.trim()}
                >
                  {saving ? '保存中...' : '保存更改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .album-container {
          display: flex;
          min-height: 100vh;
          background: var(--bg);
        }
        
        .album-sidebar {
          width: 320px;
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 24px;
          overflow-y: auto;
          position: sticky;
          top: 0;
          height: 100vh;
        }
        
        .album-header {
          margin-bottom: 32px;
        }
        
        .title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        
        .edit-album-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }
        
        .edit-album-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        
        .edit-album-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .back-btn {
          color: var(--primary);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 16px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--primary), transparent 90%);
          border: 1px solid color-mix(in srgb, var(--primary), transparent 70%);
          transition: all 0.2s ease;
          width: fit-content;
        }
        
        .back-btn:hover {
          background: color-mix(in srgb, var(--primary), transparent 80%);
          border-color: var(--primary);
          transform: translateY(-1px);
        }
        
        .back-arrow {
          font-size: 16px;
          font-weight: bold;
        }
        
        .album-title {
          font-size: 24px;
          font-weight: 700;
          color: var(--text);
          margin: 0;
          line-height: 1.3;
        }
        
        .album-details {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .value {
          font-size: 14px;
          color: var(--text);
          font-weight: 500;
        }
        
        .album-content {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }
        
        .images-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
        }
        
        .image-card {
          background: var(--surface);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--border);
          transition: all 0.3s ease;
          position: relative;
        }
        
        .image-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px color-mix(in srgb, var(--text), transparent 85%);
        }
        
        .image-wrapper {
          aspect-ratio: 1;
          overflow: hidden;
          background: var(--border);
          cursor: pointer;
        }
        
        .image-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
        }
        
        .image-wrapper:hover img {
          transform: scale(1.05);
        }
        
        .image-info {
          padding: 12px;
        }
        
        .image-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 4px;
          word-break: break-all;
        }
        
        .image-size {
          font-size: 11px;
          color: var(--text-secondary);
        }
        
        .loading, .error {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          font-size: 18px;
          color: var(--text-secondary);
        }
        
        .error {
          color: #ef4444;
        }
        
        .album-controls {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .upload-btn {
          width: 100%;
          background: var(--primary);
          color: white;
          border: none;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        
        .upload-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        
        .upload-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .delete-mode-btn {
          width: 100%;
          background: #ef4444;
          color: white;
          border: none;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          margin-bottom: 16px;
        }
        
        .delete-mode-btn:hover:not(:disabled) {
          background: #dc2626;
          transform: translateY(-1px);
        }
        
        .delete-mode-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .delete-actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .selected-count {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 0;
          text-align: center;
        }
        
        .delete-confirm-btn {
          width: 100%;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          border: none;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px color-mix(in srgb, #ef4444, transparent 70%);
        }
        
        .delete-confirm-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #dc2626, #b91c1c);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px color-mix(in srgb, #ef4444, transparent 60%);
        }
        
        .delete-confirm-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .image-card.delete-mode {
          cursor: pointer;
        }
        
        .image-card.delete-mode:hover:not(.selected) {
          border-color: color-mix(in srgb, #ef4444, transparent 50%);
          box-shadow: 0 6px 20px color-mix(in srgb, #ef4444, transparent 80%);
          transform: translateY(-2px);
        }
        
        .image-card.selected {
          border-color: #ef4444;
          box-shadow: 0 8px 32px color-mix(in srgb, #ef4444, transparent 75%);
          transform: translateY(-4px) scale(1.02);
        }
        
        .image-card.selected::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, color-mix(in srgb, #ef4444, transparent 90%) 0%, transparent 70%);
          pointer-events: none;
          border-radius: 12px;
        }
        
        .select-overlay {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 10;
          width: 28px;
          height: 28px;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          border: 2px solid color-mix(in srgb, #ef4444, transparent 60%);
          transition: all 0.3s ease;
          cursor: pointer;
        }
        
        .select-overlay.selected {
          background: #ef4444;
          border-color: #ef4444;
          box-shadow: 0 4px 12px color-mix(in srgb, #ef4444, transparent 70%);
        }
        
        .select-overlay:hover {
          transform: scale(1.1);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .select-overlay svg {
          opacity: 1;
          transition: all 0.2s ease;
        }
        
        .image-card.delete-mode .image-wrapper {
          cursor: pointer;
        }
        
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        
        .modal-content {
          background: var(--surface);
          border-radius: 12px;
          padding: 0;
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          border: 1px solid var(--border);
        }
        
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border);
        }
        
        .modal-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
        }
        
        .close-btn {
          background: none;
          border: none;
          font-size: 18px;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
        }
        
        .close-btn:hover {
          background: var(--border);
          color: var(--text);
        }
        
        .edit-form {
          padding: 24px;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
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
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
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
        
        .form-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid var(--border);
        }
        
        .cancel-btn {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border);
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .cancel-btn:hover:not(:disabled) {
          background: var(--border);
          color: var(--text);
        }
        
        .save-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .save-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        
        .save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}