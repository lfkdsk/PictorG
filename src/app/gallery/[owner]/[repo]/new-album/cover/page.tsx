'use client';
import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { uploadFile, fetchGitHubFile, updateGitHubFile, getFileSha, getGitHubToken } from '@/lib/github';
import yaml from 'js-yaml';

interface AlbumForm {
  name: string;
  url: string;
  date: string;
  style: string;
  location: string;
}

interface AlbumInfo {
  name: string;
  url: string;
  date: string | Date;
  style: string;
  cover: string;
  location?: [number, number];
}

export default function CoverSelectionPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;



  const [albumForm, setAlbumForm] = useState<AlbumForm | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [selectedCover, setSelectedCover] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  // 从sessionStorage加载数据
  useEffect(() => {
    try {
      const savedForm = sessionStorage.getItem('newAlbumForm');
      const savedFiles = sessionStorage.getItem('uploadedFiles');
      
      if (!savedForm || !savedFiles) {
        // 如果没有数据，返回第一步
        window.location.href = `/gallery/${owner}/${repo}/new-album`;
        return;
      }
      
      setAlbumForm(JSON.parse(savedForm));
      setUploadedFiles(JSON.parse(savedFiles));
    } catch (error) {
      console.error('Failed to load data:', error);
      window.location.href = `/gallery/${owner}/${repo}/new-album`;
    }
  }, [owner, repo]);

  const getImageUrl = (filename: string) => {
    // 使用GitHub raw URL作为预览
    return `https://raw.githubusercontent.com/${owner}/${repo}/master/${albumForm?.url}/${filename}`;
  };

  const createAlbum = async () => {
    if (!albumForm || !selectedCover) {
      alert('请选择封面图片');
      return;
    }

    const token = getGitHubToken();
    if (!token) {
      alert('请先登录GitHub');
      return;
    }

    setIsCreating(true);
    try {
      let readmeData: Record<string, Omit<AlbumInfo, 'name'>> = {};
      let sha: string | undefined;

      // 尝试读取现有的README.yml
      try {
        const content = await fetchGitHubFile(token, owner, repo, 'README.yml');
        readmeData = yaml.load(content, { 
          schema: yaml.CORE_SCHEMA, // 使用核心schema，避免自动类型转换
          json: true 
        }) as Record<string, Omit<AlbumInfo, 'name'>>;

        // 获取文件SHA用于更新
        sha = await getFileSha(token, owner, repo, 'README.yml');
      } catch (error) {
        // README.yml不存在，使用空对象
        console.log('README.yml不存在，将创建新文件');
      }

      // 添加新相册
      const lastDotIndex = selectedCover.lastIndexOf('.');
      const finalCoverName = lastDotIndex > 0 
        ? selectedCover.substring(0, lastDotIndex) + selectedCover.substring(lastDotIndex).toLowerCase()
        : selectedCover;
      
      const albumData: any = {
        url: albumForm.url,
        date: String(albumForm.date), // 强制转换为字符串，确保是YYYY-MM-DD格式
        style: albumForm.style,
        cover: `${albumForm.url}/${finalCoverName}`
      };

      // 解析地理位置为数组格式 [纬度, 经度]
      if (albumForm.location.trim()) {
        try {
          const coords = albumForm.location.split(',').map(s => parseFloat(s.trim()));
          if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
            albumData.location = coords; // 数组格式：[纬度, 经度]
          }
        } catch (error) {
          console.warn('Invalid location format:', error);
        }
      }

      // 将新相册放在开头
      const newReadmeData: Record<string, Omit<AlbumInfo, 'name'>> = {};
      newReadmeData[albumForm.name] = albumData;
      
      // 将现有相册添加到后面
      Object.keys(readmeData).forEach(key => {
        newReadmeData[key] = readmeData[key];
      });

      // 转换为YAML并上传，使用与编辑相册信息相同的配置
      const yamlContent = yaml.dump(newReadmeData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false
      });

      // 使用通用的文件更新函数
      await updateGitHubFile(
        token,
        owner,
        repo,
        'README.yml',
        yamlContent,
        `Add new album: ${albumForm.name}`,
        sha
      );

      // 清理sessionStorage
      sessionStorage.removeItem('newAlbumForm');
      sessionStorage.removeItem('uploadedFiles');

      alert('相册创建成功！');
      
      // 返回gallery页面
      window.location.href = `/gallery/${owner}/${repo}`;
      
    } catch (error) {
      console.error('创建相册失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      alert(`创建相册失败: ${errorMessage}`);
    } finally {
      setIsCreating(false);
    }
  };

  if (!albumForm || uploadedFiles.length === 0) {
    return <div>加载中...</div>;
  }

  return (
    <div className="cover-selection-container">
      {/* 顶部导航 */}
      <div className="top-nav">
        <Link 
          href={`/gallery/${owner}/${repo}/new-album/upload`}
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
          <span>上一步</span>
        </Link>
        
        <div className="nav-title">
          <h1>新增相册 - 步骤 3/3</h1>
          <p>为「{albumForm.name}」选择封面图片</p>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="main-content">
        <div className="cover-section">
          <h2>选择封面图片</h2>
          <p className="section-subtitle">点击选择一张图片作为相册封面</p>
          
          <div className="images-grid">
            {uploadedFiles.map((filename, index) => (
              <div 
                key={index} 
                className={`cover-option ${selectedCover === filename ? 'selected' : ''}`}
                onClick={() => setSelectedCover(filename)}
              >
                <div className="cover-preview">
                  <img 
                    src={getImageUrl(filename)}
                    alt={filename}
                    className="cover-image"
                  />
                  {selectedCover === filename && (
                    <div className="selected-badge">
                      ✓ 已选择
                    </div>
                  )}
                </div>
                <div className="cover-info">
                  <div className="cover-name">{filename}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button 
            className="create-btn"
            onClick={createAlbum}
            disabled={!selectedCover || isCreating}
          >
            {isCreating ? '创建中...' : '完成创建相册'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .cover-selection-container {
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
        
        .main-content {
          flex: 1;
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 24px;
          width: 100%;
        }
        
        .cover-section {
          margin-bottom: 32px;
        }
        
        .cover-section h2 {
          font-size: 24px;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 8px;
        }
        
        .section-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 0 0 24px;
        }
        
        .images-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }
        
        .cover-option {
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
        }
        
        .cover-option:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px color-mix(in srgb, var(--text), transparent 90%);
          border-color: color-mix(in srgb, var(--primary), transparent 50%);
        }
        
        .cover-option.selected {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary), transparent 80%);
        }
        
        .cover-preview {
          position: relative;
          width: 100%;
          aspect-ratio: 3/2;
          background: var(--border);
          overflow: hidden;
        }
        
        .cover-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          background-position: center;
          background-size: cover;
        }
        
        .selected-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          background: var(--primary);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }
        
        .cover-info {
          padding: 16px;
        }
        
        .cover-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
          word-break: break-all;
        }
        
        .form-actions {
          display: flex;
          justify-content: center;
          margin-top: 32px;
        }
        
        .create-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 16px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 200px;
        }
        
        .create-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-1px);
        }
        
        .create-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}