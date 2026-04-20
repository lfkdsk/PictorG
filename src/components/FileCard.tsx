'use client';
import { memo, useEffect, useState } from 'react';

export interface FileWithCompression {
  original: File;
  compressed?: File;
  isCompressing?: boolean;
  isUploaded?: boolean;
  uploadProgress?: number;
}

export type FileCardVariant = 'album' | 'new-album';

interface Props {
  fileObj: FileWithCompression;
  variant: FileCardVariant;
  onDownload?: (file: File) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function FileCardBase({ fileObj, variant, onDownload }: Props) {
  const displayFile = fileObj.compressed || fileObj.original;
  const isCompressed = !!fileObj.compressed;
  const isImage = displayFile.type.startsWith('image/');

  // Blob URL lifecycle: 每个 displayFile 引用只创建一次 URL，并在卸载/替换时 revoke。
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(displayFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [displayFile, isImage]);

  return (
    <div className={`file-card ${isCompressed ? 'compressed' : ''} ${variant}`}>
      <div className="file-preview">
        {isImage && previewUrl ? (
          <img src={previewUrl} alt={displayFile.name} className="preview-image" />
        ) : !isImage ? (
          <div className="file-icon">📄</div>
        ) : null}

        {fileObj.isCompressing && <div className="compression-badge">压缩中...</div>}

        {fileObj.uploadProgress !== undefined && fileObj.uploadProgress >= 0 && (
          <div className="upload-badge">
            {fileObj.uploadProgress === 100 ? '已上传' : `上传中 ${fileObj.uploadProgress}%`}
          </div>
        )}

        {fileObj.uploadProgress === -1 && (
          <div className="upload-badge error">上传失败</div>
        )}

        {isCompressed && !fileObj.isUploaded && (
          <>
            <div className="compression-badge">
              -{Math.round((1 - displayFile.size / fileObj.original.size) * 100)}%
            </div>
            {onDownload && (
              <button
                className="download-btn"
                onClick={() => onDownload(displayFile)}
                title="下载压缩后的文件"
              >
                💾
              </button>
            )}
          </>
        )}

        {fileObj.isUploaded && <div className="uploaded-badge">✅ 已上传</div>}
      </div>

      <div className="file-info">
        <div className="file-name">{displayFile.name}</div>
        <div className="file-details">
          {isCompressed ? (
            <>
              <span className="file-size original">{formatFileSize(fileObj.original.size)}</span>
              <span className="arrow">→</span>
              <span className="file-size compressed">{formatFileSize(displayFile.size)}</span>
            </>
          ) : (
            <>
              <span className="file-size">{formatFileSize(displayFile.size)}</span>
              <span className="file-type">{displayFile.type || '未知类型'}</span>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .file-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.3s ease;
          position: relative;
        }

        /* album 变体 */
        .file-card.album {
          padding: 0;
        }
        .file-card.album:hover {
          border-color: var(--primary);
          transform: translateY(-4px);
          box-shadow: 0 8px 25px color-mix(in srgb, var(--text), transparent 85%);
        }
        .file-card.album.compressed {
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--primary), transparent 95%) 0%,
            color-mix(in srgb, var(--primary), transparent 98%) 100%);
          border: 2px solid var(--primary);
          box-shadow: 0 4px 15px color-mix(in srgb, var(--primary), transparent 80%);
        }
        .file-card.album.compressed::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary), #fbbf24 50%));
        }

        /* new-album 变体 */
        .file-card.new-album:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px color-mix(in srgb, var(--text), transparent 90%);
        }
        .file-card.new-album.compressed::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary), #10b981 50%));
        }

        .file-preview {
          position: relative;
          width: 100%;
          aspect-ratio: 3/2;
          background: var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .preview-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .file-icon {
          font-size: 48px;
          color: var(--text-secondary);
        }

        .compression-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .upload-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          background: var(--primary);
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
        .upload-badge.error {
          background: #ef4444;
        }

        .uploaded-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          background: #10b981;
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .download-btn {
          position: absolute;
          bottom: 8px;
          right: 8px;
          background: var(--primary);
          color: white;
          border: none;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .download-btn:hover {
          background: color-mix(in srgb, var(--primary), black 10%);
          transform: scale(1.1);
        }

        /* file-info 的 album / new-album 分别有不同配色 */
        .file-info {
          padding: 12px 16px;
          position: relative;
        }
        .file-card.album .file-info {
          background: color-mix(in srgb, var(--text), transparent 10%);
          color: var(--bg);
        }
        .file-card.album.compressed .file-info {
          background: linear-gradient(135deg,
            var(--primary) 0%,
            color-mix(in srgb, var(--primary), black 20%) 100%);
          color: white;
        }
        .file-card.new-album .file-info {
          background: var(--surface);
        }
        .file-card.new-album.compressed .file-info {
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--primary), transparent 95%) 0%,
            var(--surface) 50%);
        }

        .file-name {
          font-weight: 500;
          font-size: 14px;
          margin-bottom: 4px;
        }
        .file-card.album .file-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .file-card.new-album .file-name {
          color: var(--text);
          word-break: break-all;
        }

        .file-details {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .file-card.album .file-details {
          opacity: 0.9;
        }

        .file-size {
          font-weight: 500;
        }
        .file-card.new-album .file-size {
          color: var(--text-secondary);
          font-weight: normal;
        }

        .file-card.album .file-size.original {
          text-decoration: line-through;
          opacity: 0.7;
        }
        .file-card.new-album .file-size.original {
          color: #ef4444;
          text-decoration: line-through;
        }

        .file-card.album .file-size.compressed {
          color: #4ade80;
          font-weight: 600;
        }
        .file-card.new-album .file-size.compressed {
          color: #10b981;
          font-weight: 600;
        }

        .file-card.album .arrow {
          color: #fbbf24;
          font-weight: bold;
        }
        .file-card.new-album .arrow {
          color: var(--text-secondary);
        }

        .file-card.album .file-type {
          opacity: 0.7;
          font-size: 11px;
        }
        .file-card.new-album .file-type {
          color: var(--text-secondary);
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
          background: var(--border);
          padding: 2px 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}

const FileCard = memo(FileCardBase);
export default FileCard;
