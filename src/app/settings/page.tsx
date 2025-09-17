'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface CompressionSettings {
  enableWebP: boolean;
  preserveEXIF: boolean;
  outputFormat: 'webp' | 'jpeg';
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<CompressionSettings>({
    enableWebP: true,
    preserveEXIF: true,
    outputFormat: 'webp'
  });

  // 从localStorage加载设置
  useEffect(() => {
    try {
      const saved = localStorage.getItem('compressionSettings');
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, []);

  // 保存设置到localStorage
  const saveSettings = (newSettings: CompressionSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('compressionSettings', JSON.stringify(newSettings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const handleToggle = (key: keyof CompressionSettings) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    saveSettings(newSettings);
  };

  const handleFormatChange = (format: 'webp' | 'jpeg') => {
    const newSettings = { ...settings, outputFormat: format };
    saveSettings(newSettings);
  };

  return (
    <div className="settings-container">
      <div className="settings-content">
        <div className="settings-header">
          <Link 
            href="/main" 
            className="back-btn"
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
            <span>返回主页</span>
          </Link>
          <h1>设置</h1>
        </div>

        <div className="settings-sections">
          <div className="settings-section">
            <h2>图片压缩设置</h2>
            <p className="section-description">配置图片上传时的压缩选项</p>
            
            <div className="setting-item">
              <div className="setting-info">
                <label className="setting-label">启用图片压缩</label>
                <p className="setting-desc">上传时自动压缩图片以减小文件大小</p>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.enableWebP}
                  onChange={() => handleToggle('enableWebP')}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label className="setting-label">保留EXIF信息</label>
                <p className="setting-desc">保留照片的拍摄信息（位置、时间、相机参数等）</p>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.preserveEXIF}
                  onChange={() => handleToggle('preserveEXIF')}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label className="setting-label">输出格式</label>
                <p className="setting-desc">选择压缩后的图片格式</p>
              </div>
              <div className="format-options">
                <label className={`format-option ${settings.outputFormat === 'webp' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="format"
                    value="webp"
                    checked={settings.outputFormat === 'webp'}
                    onChange={() => handleFormatChange('webp')}
                  />
                  <span>WebP</span>
                  <small>更小的文件大小，现代浏览器支持</small>
                </label>
                <label className={`format-option ${settings.outputFormat === 'jpeg' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="format"
                    value="jpeg"
                    checked={settings.outputFormat === 'jpeg'}
                    onChange={() => handleFormatChange('jpeg')}
                  />
                  <span>JPEG</span>
                  <small>通用格式，所有设备支持</small>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .settings-container {
          min-height: 100vh;
          background: var(--bg);
        }
        
        .settings-content {
          max-width: 800px;
          margin: 0 auto;
          padding: 24px;
        }
        
        .settings-header {
          margin-bottom: 32px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        
        .settings-header h1 {
          font-size: 20px;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        
        .settings-section {
          background: var(--surface);
          border-radius: 12px;
          padding: 24px;
          border: 1px solid var(--border);
        }
        
        .settings-section h2 {
          font-size: 20px;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 8px;
        }
        
        .section-description {
          color: var(--text-secondary);
          margin: 0 0 24px;
          font-size: 14px;
        }
        
        .setting-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 16px 0;
          border-bottom: 1px solid var(--border);
        }
        
        .setting-item:last-child {
          border-bottom: none;
        }
        
        .setting-info {
          flex: 1;
          margin-right: 16px;
        }
        
        .setting-label {
          font-size: 16px;
          font-weight: 500;
          color: var(--text);
          display: block;
          margin-bottom: 4px;
        }
        
        .setting-desc {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 0;
        }
        
        .toggle {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        
        .toggle input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--border);
          transition: 0.3s;
          border-radius: 24px;
        }
        
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        
        input:checked + .slider {
          background-color: var(--primary);
        }
        
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        
        .format-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .format-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .format-option:hover {
          border-color: var(--primary);
        }
        
        .format-option.active {
          border-color: var(--primary);
          background: color-mix(in srgb, var(--primary), transparent 95%);
        }
        
        .format-option input {
          margin: 0;
        }
        
        .format-option span {
          font-weight: 500;
          color: var(--text);
        }
        
        .format-option small {
          display: block;
          color: var(--text-secondary);
          font-size: 12px;
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}