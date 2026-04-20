'use client';
import { useParams } from 'next/navigation';
import { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { compressImage } from '@/lib/compress-image';
import { uploadFile, fileToBase64, batchUploadFiles, BatchUploadFile, getGitHubToken } from '@/lib/github';
import FileCard, { FileWithCompression } from '@/components/FileCard';

interface AlbumForm {
  name: string;
  url: string;
  date: string;
  style: string;
  location: string;
}

export default function NewAlbumUploadPage() {
  const params = useParams();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const [albumForm, setAlbumForm] = useState<AlbumForm | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileWithCompression[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // 从sessionStorage加载相册信息
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('newAlbumForm');
      if (saved) {
        setAlbumForm(JSON.parse(saved));
      } else {
        // 如果没有表单数据，返回第一步
        window.location.href = `/gallery/${owner}/${repo}/new-album`;
      }
    } catch (error) {
      console.error('Failed to load album form:', error);
      window.location.href = `/gallery/${owner}/${repo}/new-album`;
    }
  }, [owner, repo]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(event.target.files || []);
    setSelectedFiles(prevFiles => {
      const existingNames = new Set(prevFiles.map(f => f.original.name));
      const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name));
      const newFileObjects = uniqueNewFiles.map(file => ({ original: file }));
      return [...prevFiles, ...newFileObjects];
    });
    event.target.value = '';
  };

  const clearAllFiles = () => {
    setSelectedFiles([]);
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleCompress = async () => {
    if (selectedFiles.length === 0) return;
    
    const filesToCompress = selectedFiles
      .map((fileObj, index) => ({ fileObj, index }))
      .filter(({ fileObj }) => !fileObj.compressed && !fileObj.isCompressing);
    
    if (filesToCompress.length === 0) {
      alert('没有需要压缩的文件');
      return;
    }
    
    for (const { fileObj, index } of filesToCompress) {
      setSelectedFiles(prev => prev.map((f, i) => 
        i === index ? { ...f, isCompressing: true } : f
      ));
      
      try {
        const compressed = await compressImage(fileObj.original);
        setSelectedFiles(prev => prev.map((f, i) => 
          i === index ? { ...f, compressed, isCompressing: false } : f
        ));
      } catch (error) {
        console.error('压缩失败:', error);
        setSelectedFiles(prev => prev.map((f, i) => 
          i === index ? { ...f, isCompressing: false } : f
        ));
      }
    }
  };

  const handleUpload = async () => {
    if (!albumForm) return;
    
    const token = getGitHubToken();
    if (!token) {
      alert('请先登录GitHub');
      return;
    }

    const filesToUpload = selectedFiles
      .map((fileObj, index) => ({ fileObj, index }))
      .filter(({ fileObj }) => !fileObj.isUploaded && !fileObj.isCompressing);
    
    if (filesToUpload.length === 0) {
      alert('没有需要上传的文件');
      return;
    }

    setIsUploading(true);

    try {
      // 标记所有文件开始上传
      const uploadIndices = filesToUpload.map(({ index }) => index);
      setSelectedFiles(prev => prev.map((f, i) => 
        uploadIndices.includes(i) ? { ...f, uploadProgress: 0 } : f
      ));

      // 准备批量上传的文件
      const batchFiles: BatchUploadFile[] = [];
      
      for (const { fileObj } of filesToUpload) {
        const file = fileObj.compressed || fileObj.original;
        const base64Content = await fileToBase64(file);
        
        // 只将文件后缀转为小写
        const fileName = file.name;
        const lastDotIndex = fileName.lastIndexOf('.');
        const finalFileName = lastDotIndex > 0 
          ? fileName.substring(0, lastDotIndex) + fileName.substring(lastDotIndex).toLowerCase()
          : fileName;
        
        batchFiles.push({
          path: `${albumForm.url}/${finalFileName}`,
          content: base64Content
        });
      }

      // 批量上传所有文件
      await batchUploadFiles(
        token,
        owner,
        repo,
        batchFiles,
        `Upload ${filesToUpload.length} images to ${albumForm.name}`
      );

      // 标记所有文件上传完成
      setSelectedFiles(prev => prev.map((f, i) => 
        uploadIndices.includes(i) ? { ...f, uploadProgress: 100, isUploaded: true } : f
      ));

      alert(`成功上传 ${filesToUpload.length} 个文件`);
      
    } catch (error) {
      console.error('批量上传失败:', error);
      
      // 标记所有文件上传失败
      const uploadIndices = filesToUpload.map(({ index }) => index);
      setSelectedFiles(prev => prev.map((f, i) => 
        uploadIndices.includes(i) ? { ...f, uploadProgress: -1 } : f
      ));
      
      alert('上传失败，请检查网络连接和权限');
    } finally {
      setIsUploading(false);
    }
  };

  const handleNext = () => {
    const uploadedFiles = selectedFiles.filter(f => f.isUploaded);
    if (uploadedFiles.length === 0) {
      alert('请先上传至少一张图片');
      return;
    }

    // 将上传的文件信息存储到sessionStorage（只将后缀转为小写）
    const uploadedFileNames = uploadedFiles.map(f => {
      const fileName = (f.compressed || f.original).name;
      const lastDotIndex = fileName.lastIndexOf('.');
      return lastDotIndex > 0 
        ? fileName.substring(0, lastDotIndex) + fileName.substring(lastDotIndex).toLowerCase()
        : fileName;
    });
    sessionStorage.setItem('uploadedFiles', JSON.stringify(uploadedFileNames));
    
    // 跳转到第三步：选择封面
    window.location.href = `/gallery/${owner}/${repo}/new-album/cover`;
  };

  const handleDownload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  if (!albumForm) {
    return <div>加载中...</div>;
  }

  return (
    <div className="upload-container">
      {/* 顶部导航栏 */}
      <div className="top-nav">
        <Link 
          href={`/gallery/${owner}/${repo}/new-album`}
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
          <h1>新增相册 - 步骤 2/3</h1>
          <p>上传图片到「{albumForm.name}」</p>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="main-content">
        {/* 左侧图片展示区域 */}
        <div className="left-panel">
          {selectedFiles.length > 0 && (
            <div className="files-section">
              <h3>选中的文件 ({selectedFiles.length})</h3>
              <div className="files-grid">
                {selectedFiles.map((fileObj, index) => (
                  <FileCard
                    key={index}
                    fileObj={fileObj}
                    variant="new-album"
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧操作面板 */}
        <div className="right-panel">
          {/* 文件选择区域 */}
          <div className="file-select-area">
            <input
              type="file"
              id="file-input"
              multiple
              onChange={handleFileSelect}
              className="file-input"
              accept="*/*"
            />
            <label htmlFor="file-input" className="file-select-btn">
              📁 选择文件
            </label>
            <p className="file-hint">支持多选，不限制文件类型</p>
            
            <div className="repo-info">
              <div className="repo-detail">
                <span className="label">仓库:</span>
                <span className="value">{owner}/{repo}</span>
              </div>
              <div className="repo-detail">
                <span className="label">相册:</span>
                <span className="value">{albumForm?.name}</span>
              </div>
              <div className="repo-detail">
                <span className="label">URL:</span>
                <span className="value">{albumForm?.url}</span>
              </div>
            </div>
          </div>

          {/* 操作按钮区域 */}
          {selectedFiles.length > 0 && (
            <div className="action-panel">
              <div className="button-row">
                <button 
                  className="action-btn clear-btn"
                  onClick={clearAllFiles}
                  disabled={isUploading || selectedFiles.some(f => f.isCompressing)}
                >
                  🗑️ 清空
                </button>
                
                <button 
                  className="action-btn compress-btn"
                  onClick={handleCompress}
                  disabled={selectedFiles.some(f => f.isCompressing)}
                >
                  {selectedFiles.some(f => f.isCompressing) ? '压缩中...' : '🗜️ 压缩'}
                </button>
              </div>
              
              {selectedFiles.some(f => !f.isUploaded) && (
                <button 
                  className="action-btn upload-btn full-width"
                  onClick={handleUpload}
                  disabled={isUploading || selectedFiles.some(f => f.isCompressing)}
                >
                  {isUploading ? '上传中...' : '📤 开始上传'}
                </button>
              )}
              
              {selectedFiles.some(f => f.isUploaded) && (
                <button 
                  className="action-btn next-btn full-width"
                  onClick={handleNext}
                  disabled={isUploading}
                >
                  下一步：选择封面 →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .upload-container {
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
          display: grid;
          grid-template-columns: 250px 1fr;
          height: calc(100vh - 80px);
        }
        
        .left-panel {
          background: var(--bg);
          padding: 24px;
          overflow-y: auto;
        }
        
        .right-panel {
          background: var(--bg);
          padding: 24px;
          overflow-y: auto;
        }
        
        .file-select-area {
          background: var(--bg);
          border: 2px dashed var(--border);
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          margin-bottom: 24px;
        }
        
        .file-select-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: 120px;
          justify-content: center;
        }
        
        .file-select-btn:hover {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-2px);
        }
        
        .file-hint {
          margin: 16px 0 0;
          color: var(--text-secondary);
          font-size: 14px;
        }
        
        .repo-info {
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
        }
        
        .repo-detail {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
          font-size: 12px;
        }
        
        .repo-detail:last-child {
          margin-bottom: 0;
        }
        
        .repo-detail .label {
          color: var(--text-secondary);
          font-weight: 500;
        }
        
        .repo-detail .value {
          color: var(--text);
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
          background: var(--surface);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
        }
        
        .action-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .button-row {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        
        .action-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          width: auto;
          min-width: 80px;
        }
        
        .action-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: translateY(-2px);
        }
        
        .action-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .clear-btn {
          background: #ef4444;
        }
        
        .clear-btn:hover:not(:disabled) {
          background: color-mix(in srgb, #ef4444, black 10%);
        }
        
        .next-btn {
          background: #10b981;
        }
        
        .next-btn:hover:not(:disabled) {
          background: color-mix(in srgb, #10b981, black 10%);
        }
        
        .full-width {
          width: 100% !important;
        }
        
        .file-input {
          display: none;
        }
        
        .files-section {
          margin-bottom: 32px;
        }
        
        .files-section h3 {
          color: var(--text);
          font-size: 16px;
          margin: 0 0 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        
        .files-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
      `}</style>
    </div>
  );
}
