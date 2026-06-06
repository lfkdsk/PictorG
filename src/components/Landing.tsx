'use client';
import { useEffect, useState } from 'react';
import { getStoredUser } from '@/lib/auth';
import ThemeToggle from './ThemeToggle';

const REPO = 'lfkdsk/PictorG';
const FALLBACK_VERSION = '0.1.16';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const REPO_URL = `https://github.com/${REPO}`;
const WEB_DEMO_URL = 'https://pictor-g.vercel.app';

const dmgUrl = (version: string, arch: string) =>
  `https://github.com/${REPO}/releases/download/v${version}/PicG-${version}-${arch}.dmg`;

type Release = {
  version: string;
  arm64: string;
  x64: string;
  htmlUrl: string;
};

function defaultRelease(): Release {
  return {
    version: FALLBACK_VERSION,
    arm64: dmgUrl(FALLBACK_VERSION, 'arm64'),
    x64: dmgUrl(FALLBACK_VERSION, 'x64'),
    htmlUrl: RELEASES_URL,
  };
}

const features = [
  {
    title: 'GitHub OAuth 登录',
    desc: '用你的 GitHub 账号一键登录，照片始终存放在你自己的仓库里，数据完全自主可控。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: '仓库即相册',
    desc: '自动把 GitHub 仓库同步为相册，无需迁移数据。新建、编辑、删除相册都只是一次提交。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    ),
  },
  {
    title: '多种布局',
    desc: '网格、瀑布流、紧凑、大图等展示模式自由切换，每一组照片都能找到最适合它的呈现方式。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    title: '批量上传与压缩',
    desc: '拖拽即可批量上传，浏览器端自动压缩、保留或清除 EXIF，体积更小、加载更快。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        <path d="M12 15V4" />
        <path d="M8 8l4-4 4 4" />
      </svg>
    ),
  },
  {
    title: '明暗主题',
    desc: '精心调校的暖色明亮主题与沉稳暗色主题，一键切换，随系统偏好自动适配。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.8A8.5 8.5 0 1111.2 3a6.5 6.5 0 109.8 9.8z" />
      </svg>
    ),
  },
  {
    title: '响应式设计',
    desc: '从手机到大屏桌面都有细腻的版式与交互，随时随地浏览和管理你的照片。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="14" height="11" rx="1.5" />
        <rect x="17" y="8" width="5" height="12" rx="1.5" />
        <path d="M2 19h9" />
      </svg>
    ),
  },
  {
    title: 'YAML 元数据',
    desc: '相册标题、封面、描述都以纯文本 YAML 存储，可读、可版本化、可随仓库迁移。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10V7l-2-2h-2" />
        <path d="M4 7l4 5-4 5" />
        <path d="M11 12h9" />
        <path d="M11 17h6" />
      </svg>
    ),
  },
  {
    title: '中英文国际化',
    desc: '内置中文与英文界面，团队协作或对外分享都能用熟悉的语言。',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 010 18a14 14 0 010-18z" />
      </svg>
    ),
  },
];

const desktopPoints = [
  {
    title: '本地优先',
    desc: '相册仓库 clone 到本地，编辑直接落到工作区。',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 9.5V20h14V9.5" />
        <path d="M9.5 20v-6h5v6" />
      </svg>
    ),
  },
  {
    title: '离线可用',
    desc: '写文件、压缩、改 YAML 全程不依赖网络。',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" />
        <path d="M8.5 12.5a5 5 0 017 0" />
        <path d="M5 9a10 10 0 0114 0" />
        <path d="M12 19h.01" />
      </svg>
    ),
  },
  {
    title: 'Git 工作流',
    desc: '每次写入生成本地 commit，推送是独立动作。',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7" />
        <path d="M18 10.5c0 4-4 3.5-6.5 5.5" />
      </svg>
    ),
  },
  {
    title: '原生体验',
    desc: '多窗口、系统级文件操作、独立压缩 Worker。',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z" />
      </svg>
    ),
  },
];

const steps = [
  { n: '01', title: '登录 GitHub', desc: '用 OAuth 安全登录，授权后即可读取你的仓库。' },
  { n: '02', title: '选择或新建相册', desc: '把已有仓库变成相册，或一键创建新的相册仓库。' },
  { n: '03', title: '上传与整理', desc: '拖拽批量上传、自动压缩、设置封面与元数据。' },
  { n: '04', title: '分享与浏览', desc: '生成精美的在线相册，随时在 Web 与桌面端访问。' },
];

export default function Landing() {
  const [release, setRelease] = useState<Release>(defaultRelease);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getStoredUser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: any) => {
        if (cancelled) return;
        const version = String(data.tag_name || '').replace(/^v/, '') || FALLBACK_VERSION;
        const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
        const pick = (kws: string[]) =>
          assets.find(
            (a) => /\.dmg$/i.test(a?.name || '') && kws.some((k) => a.name.toLowerCase().includes(k))
          )?.browser_download_url as string | undefined;
        setRelease({
          version,
          arm64: pick(['arm64', 'aarch64']) || dmgUrl(version, 'arm64'),
          x64: pick(['x64', 'x86_64', 'intel']) || dmgUrl(version, 'x64'),
          htmlUrl: data.html_url || RELEASES_URL,
        });
      })
      .catch(() => {
        /* keep fallback release */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const webHref = loggedIn ? '/main' : '/login';
  const webLabel = loggedIn ? '进入我的画廊' : '打开 Web 版';

  return (
    <div className="landing" id="top">
      {/* ===== Header ===== */}
      <header className="lnav">
        <div className="lnav-inner">
          <a className="lnav-brand" href="#top" aria-label="PictorG">
            <span className="logo" aria-hidden>
              <svg viewBox="0 0 1024 1024" width="30" height="30">
                <rect width="1024" height="1024" rx="244" fill="#1A1614" />
                <text x="512" y="690" textAnchor="middle" fontFamily="'Fraunces','Times New Roman',Georgia,serif" fontWeight="500" fontSize="600" fill="#EDE4D3">P</text>
                <circle cx="728" cy="690" r="40" fill="#D97757" />
              </svg>
            </span>
            <span className="wordmark">PictorG</span>
          </a>
          <nav className="lnav-links">
            <a href="#features">功能</a>
            <a href="#desktop">桌面端</a>
            <a href="#download">下载</a>
          </nav>
          <div className="lnav-actions">
            <ThemeToggle />
            <a className="lnav-gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub 仓库">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden>
                <path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.4 6.8-5.2 6.8-9.7C22 6.6 17.5 2 12 2z" />
              </svg>
            </a>
            <a className="lnav-cta" href={webHref}>{webLabel}</a>
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="hero">
        <div className="hero-bg" aria-hidden />
        <div className="wrap hero-inner">
          <span className="eyebrow">开源 · 基于 GitHub · 本地优先</span>
          <h1 className="title">
            把 GitHub 仓库
            <br />
            变成<span className="grad">优雅的私人相册</span>
          </h1>
          <p className="subtitle">
            PictorG 让你将任意 GitHub 仓库变成精美的在线相册：OAuth 登录、批量上传与压缩、多种布局、明暗主题。
            Web 与 macOS 桌面端共享同一套体验，照片始终留在你自己手里。
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="#download">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M16.5 3.2c.1 1-.3 2-1 2.8-.7.8-1.8 1.4-2.8 1.3-.1-1 .4-2 1-2.7.7-.8 1.9-1.4 2.8-1.4zM19 17c-.5 1.2-.8 1.7-1.5 2.7-.9 1.4-2.3 3.1-3.9 3.1-1.5 0-1.8-.9-3.8-.9s-2.4.9-3.8.9c-1.6 0-2.9-1.6-3.8-3C-.3 16.5-.6 12 1.3 9.6 2.4 8.2 4 7.3 5.6 7.3c1.6 0 2.6 1 3.9 1 1.3 0 2-1 3.9-1 1.4 0 2.9.8 3.9 2.1-3.5 1.9-2.9 6.9 1.7 7.6z" />
              </svg>
              下载 macOS App
            </a>
            <a className="btn btn-ghost" href={webHref}>
              {webLabel}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </a>
          </div>
          <div className="hero-meta">
            <span className="dot" /> 当前版本 v{release.version}
            <span className="sep" /> macOS arm64 / x64
            <span className="sep" /> MIT 开源许可
          </div>

          <div className="shot">
            <div className="shot-frame">
              <img src="/landing/hero.jpg" alt="PictorG 相册界面预览" loading="eager" />
            </div>
            <div className="shot-glow" aria-hidden />
          </div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section className="section" id="features">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">功能特性</span>
            <h2>管理照片，本该如此简单</h2>
            <p>从登录到分享，每一步都为「自己掌控数据」而设计。</p>
          </div>
          <div className="grid">
            {features.map((f) => (
              <div className="card" key={f.title}>
                <div className="ic">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Desktop showcase ===== */}
      <section className="section desktop" id="desktop">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">macOS 桌面端 · Beta</span>
            <h2>本地优先的原生体验</h2>
            <p>
              桌面端与 Web 端共享同一套界面和业务逻辑，差异只在数据层：相册仓库被 clone 到本地，
              所有编辑直接落到工作区，联网时再同步回 GitHub。
            </p>
          </div>
          <div className="dpoints">
            {desktopPoints.map((p) => (
              <div className="dpoint" key={p.title}>
                <span className="dp-ic">{p.icon}</span>
                <strong>{p.title}</strong>
                <span>{p.desc}</span>
              </div>
            ))}
          </div>
          <div className="dl-center">
            <a className="btn btn-primary" href="#download">下载桌面端</a>
          </div>
        </div>
      </section>

      {/* ===== Web vs Desktop ===== */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">两种方式，一套体验</span>
            <h2>挑选最适合你的入口</h2>
          </div>
          <div className="compare">
            <div className="compare-card">
              <div className="cc-head">
                <span className="cc-ic">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a14 14 0 010 18a14 14 0 010-18z" />
                  </svg>
                </span>
                <h3>Web 版</h3>
              </div>
              <p>打开即用，无需安装。直接通过 GitHub API 读写仓库，适合随时随地的快速浏览与上传。</p>
              <ul>
                <li>零安装，浏览器直达</li>
                <li>跨平台 · 手机也能用</li>
                <li>始终运行最新版本</li>
              </ul>
              <a className="btn btn-outline" href={webHref}>{webLabel}</a>
            </div>
            <div className="compare-card featured">
              <span className="badge">推荐重度使用</span>
              <div className="cc-head">
                <span className="cc-ic">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="12" rx="2" />
                    <path d="M2 20h20" />
                  </svg>
                </span>
                <h3>macOS 桌面端</h3>
              </div>
              <p>本地优先、离线可用。批量处理大量照片不卡顿，Git 工作流让每次改动都可追溯。</p>
              <ul>
                <li>本地 clone · 离线编辑</li>
                <li>独立压缩进程 · 批量更快</li>
                <li>本地 commit · 自主推送</li>
              </ul>
              <a className="btn btn-primary" href="#download">下载 macOS App</a>
            </div>
          </div>
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section className="section steps-sec">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">如何开始</span>
            <h2>四步，拥有自己的相册</h2>
          </div>
          <div className="steps">
            {steps.map((s) => (
              <div className="step" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Download ===== */}
      <section className="section download" id="download">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">下载</span>
            <h2>获取最新版 PictorG</h2>
            <p>
              最新稳定版 <strong>v{release.version}</strong> · macOS 11 及以上 · 完全免费开源
            </p>
          </div>
          <div className="dl-grid">
            <a className="dl-card" href={release.arm64}>
              <span className="dl-ic">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden>
                  <path d="M16.5 3.2c.1 1-.3 2-1 2.8-.7.8-1.8 1.4-2.8 1.3-.1-1 .4-2 1-2.7.7-.8 1.9-1.4 2.8-1.4zM19 17c-.5 1.2-.8 1.7-1.5 2.7-.9 1.4-2.3 3.1-3.9 3.1-1.5 0-1.8-.9-3.8-.9s-2.4.9-3.8.9c-1.6 0-2.9-1.6-3.8-3C-.3 16.5-.6 12 1.3 9.6 2.4 8.2 4 7.3 5.6 7.3c1.6 0 2.6 1 3.9 1 1.3 0 2-1 3.9-1 1.4 0 2.9.8 3.9 2.1-3.5 1.9-2.9 6.9 1.7 7.6z" />
                </svg>
              </span>
              <div className="dl-text">
                <strong>Apple 芯片</strong>
                <span>M 系列 · arm64 · .dmg</span>
              </div>
              <span className="dl-go" aria-hidden>↓</span>
            </a>
            <a className="dl-card" href={release.x64}>
              <span className="dl-ic">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden>
                  <path d="M16.5 3.2c.1 1-.3 2-1 2.8-.7.8-1.8 1.4-2.8 1.3-.1-1 .4-2 1-2.7.7-.8 1.9-1.4 2.8-1.4zM19 17c-.5 1.2-.8 1.7-1.5 2.7-.9 1.4-2.3 3.1-3.9 3.1-1.5 0-1.8-.9-3.8-.9s-2.4.9-3.8.9c-1.6 0-2.9-1.6-3.8-3C-.3 16.5-.6 12 1.3 9.6 2.4 8.2 4 7.3 5.6 7.3c1.6 0 2.6 1 3.9 1 1.3 0 2-1 3.9-1 1.4 0 2.9.8 3.9 2.1-3.5 1.9-2.9 6.9 1.7 7.6z" />
                </svg>
              </span>
              <div className="dl-text">
                <strong>Intel 芯片</strong>
                <span>x64 · .dmg</span>
              </div>
              <span className="dl-go" aria-hidden>↓</span>
            </a>
            <a className="dl-card web" href={webHref}>
              <span className="dl-ic">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 010 18a14 14 0 010-18z" />
                </svg>
              </span>
              <div className="dl-text">
                <strong>无需安装</strong>
                <span>{webLabel}</span>
              </div>
              <span className="dl-go" aria-hidden>→</span>
            </a>
          </div>
          <p className="dl-note">
            首次启动若被 Gatekeeper 拦截，DMG 内附带 <code>Fix Gatekeeper</code> 助手，按提示放行即可。
            其它版本与历史发布见{' '}
            <a href={release.htmlUrl} target="_blank" rel="noreferrer">GitHub Releases</a>。
          </p>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="f-brand">
            <span className="f-logo">PictorG</span>
            <p>基于 GitHub 的现代化相册管理平台。</p>
          </div>
          <div className="f-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub 仓库</a>
            <a href={WEB_DEMO_URL} target="_blank" rel="noreferrer">在线演示</a>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">发布版本</a>
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">问题反馈</a>
            <a href={`${REPO_URL}/discussions`} target="_blank" rel="noreferrer">讨论区</a>
          </div>
        </div>
        <div className="wrap f-bottom">
          <span>© {new Date().getFullYear()} PictorG · MIT License</span>
          <span>Made with ♥ by lfkdsk</span>
        </div>
      </footer>

      <style jsx global>{`
        html { overflow-x: hidden; scroll-behavior: smooth; }
      `}</style>

      <style jsx>{`
        .landing {
          width: 100vw;
          margin-left: calc(50% - 50vw);
          margin-top: -18px;
          margin-bottom: -32px;
          color: var(--text);
          --accent: var(--primary);
          --accent-soft: color-mix(in srgb, var(--primary), transparent 90%);
          --accent-line: color-mix(in srgb, var(--primary), transparent 70%);
        }
        .wrap {
          width: min(1120px, 90vw);
          margin: 0 auto;
        }

        /* ---------- Header ---------- */
        .lnav {
          position: sticky; top: 0; z-index: 50;
          background: color-mix(in srgb, var(--bg), transparent 14%);
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          border-bottom: 1px solid var(--border);
        }
        .lnav-inner {
          width: min(1120px, 92vw); margin: 0 auto; height: 62px;
          display: flex; align-items: center; gap: 16px;
        }
        .lnav-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
        .lnav-brand .logo { width: 30px; height: 30px; flex: none; display: block; border-radius: 7px; overflow: hidden; }
        .lnav-brand .logo svg { display: block; }
        .wordmark { font-family: var(--serif); font-weight: 600; font-size: 19px; letter-spacing: -0.2px; }
        .lnav-links { display: flex; align-items: center; gap: 2px; margin-left: 10px; }
        .lnav-links a { padding: 8px 12px; border-radius: 6px; text-decoration: none; color: var(--text-secondary); font-size: 14px; font-weight: 500; transition: color .15s ease, background .15s ease; }
        .lnav-links a:hover { color: var(--text); background: var(--hover); }
        .lnav-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
        .lnav-gh { width: 40px; height: 40px; border-radius: 8px; display: grid; place-items: center; color: var(--text-secondary); text-decoration: none; transition: color .15s ease, background .15s ease; }
        .lnav-gh:hover { color: var(--text); background: var(--hover); }
        .lnav-cta {
          display: inline-flex; align-items: center; height: 38px; padding: 0 16px; margin-left: 6px;
          border-radius: 7px; font-size: 14px; font-weight: 600; text-decoration: none;
          color: var(--accent-fg); background: var(--accent);
          transition: filter .15s ease;
        }
        .lnav-cta:hover { filter: brightness(1.06); }
        h2 { font-family: var(--serif); font-size: clamp(27px, 3.6vw, 40px); font-weight: 600; letter-spacing: -0.4px; margin: 0; }
        h3 { margin: 0; }
        a { color: inherit; }

        /* ---------- Hero ---------- */
        .hero { position: relative; padding: 64px 0 44px; }
        .hero-bg { display: none; }
        .hero-inner { position: relative; z-index: 1; text-align: center; }
        .eyebrow {
          display: inline-block; font-size: 12.5px; font-weight: 600; letter-spacing: 0.5px;
          color: var(--accent);
          background: var(--accent-soft);
          border: 1px solid var(--accent-line);
          padding: 5px 13px; border-radius: 5px; margin-bottom: 24px;
        }
        .title {
          font-family: var(--serif);
          font-size: clamp(36px, 5.4vw, 60px); line-height: 1.14; font-weight: 600;
          letter-spacing: -0.4px; margin: 0 auto 22px; max-width: 24ch;
        }
        .grad { color: var(--accent); }
        .subtitle {
          font-size: clamp(15px, 1.7vw, 18px); line-height: 1.75; color: var(--text-secondary);
          max-width: 58ch; margin: 0 auto 30px;
        }
        .cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .btn {
          display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 22px;
          border-radius: 7px; font-size: 15px; font-weight: 600; text-decoration: none;
          cursor: pointer; border: 1px solid transparent; transition: filter .15s ease, background .15s ease, border-color .15s ease;
        }
        .btn-primary { color: var(--accent-fg); background: var(--accent); }
        .btn-primary:hover { filter: brightness(1.06); }
        .btn-ghost { color: var(--text); background: transparent; border-color: var(--border); }
        .btn-ghost:hover { border-color: var(--text-secondary); background: var(--hover); }
        .btn-outline { color: var(--accent); background: transparent; border-color: var(--accent-line); }
        .btn-outline:hover { background: var(--accent-soft); }
        .hero-meta {
          display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
          margin-top: 24px; font-size: 12.5px; color: var(--text-secondary); font-family: var(--mono);
        }
        .hero-meta .dot { width: 7px; height: 7px; border-radius: 50%; background: #8ba668; }
        .hero-meta .sep { width: 1px; height: 12px; background: var(--border); }

        .shot { position: relative; margin: 52px auto 0; max-width: 980px; }
        .shot-frame {
          position: relative; border-radius: 10px; overflow: hidden;
          border: 1px solid var(--border); background: var(--surface);
          box-shadow: 0 20px 60px -40px rgba(0,0,0,.6);
        }
        .shot-frame img { width: 100%; height: auto; display: block; }
        .shot-glow { display: none; }

        /* ---------- Sections ---------- */
        .section { padding: 76px 0; scroll-margin-top: 76px; }
        .sec-head { text-align: center; max-width: 60ch; margin: 0 auto 48px; }
        .kicker {
          display: inline-block; font-size: 12.5px; font-weight: 600; letter-spacing: 2px;
          color: var(--accent); margin-bottom: 14px;
        }
        .sec-head p { color: var(--text-secondary); font-size: 16px; line-height: 1.65; margin: 14px 0 0; }
        .sec-head p strong { font-family: var(--mono); font-weight: 600; color: var(--text); }

        /* ---------- Feature grid ---------- */
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .card {
          background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
          padding: 22px; transition: border-color .2s ease, background .2s ease;
        }
        .card:hover { border-color: var(--accent-line); background: color-mix(in srgb, var(--surface), var(--accent) 4%); }
        .ic {
          width: 42px; height: 42px; border-radius: 7px; display: grid; place-items: center;
          color: var(--accent); margin-bottom: 16px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-line);
        }
        .card h3 { font-size: 15.5px; font-weight: 650; margin-bottom: 8px; }
        .card p { font-size: 13.5px; line-height: 1.65; color: var(--text-secondary); margin: 0; }

        /* ---------- Desktop showcase ---------- */
        .desktop {
          background: var(--surface);
          border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
        }
        .dpoints { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .dpoint {
          background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 22px;
          transition: border-color .2s ease;
        }
        .dpoint:hover { border-color: var(--accent-line); }
        .dp-ic {
          width: 40px; height: 40px; border-radius: 7px; display: grid; place-items: center;
          color: var(--accent); background: var(--accent-soft);
          border: 1px solid var(--accent-line);
        }
        .dpoint strong { display: block; font-size: 15.5px; font-weight: 650; margin: 14px 0 6px; }
        .dpoint > span:last-child { font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); }
        .dl-center { text-align: center; margin-top: 36px; }

        /* ---------- Compare ---------- */
        .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 900px; margin: 0 auto; }
        .compare-card {
          position: relative; background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 28px;
        }
        .compare-card.featured { border-color: var(--accent-line); }
        .badge {
          position: absolute; top: -10px; left: 24px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.5px; color: var(--accent-fg);
          padding: 4px 11px; border-radius: 4px;
          background: var(--accent);
        }
        .cc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .cc-ic {
          width: 38px; height: 38px; border-radius: 8px; display: grid; place-items: center; color: var(--accent);
          background: var(--accent-soft); border: 1px solid var(--accent-line);
        }
        .cc-head h3 { font-family: var(--serif); font-size: 19px; font-weight: 600; }
        .compare-card > p { color: var(--text-secondary); font-size: 14.5px; line-height: 1.65; margin: 0 0 16px; }
        .compare-card ul { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 10px; }
        .compare-card li { position: relative; padding-left: 20px; font-size: 14px; color: var(--text); }
        .compare-card li::before {
          content: ''; position: absolute; left: 2px; top: 8px; width: 6px; height: 6px; border-radius: 1px;
          background: var(--accent);
        }
        .compare-card .btn { width: 100%; justify-content: center; }

        /* ---------- Steps ---------- */
        .steps-sec { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .step {
          background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 24px;
        }
        .step-n {
          font-family: var(--mono); font-size: 26px; font-weight: 600; letter-spacing: -1px;
          color: var(--accent);
        }
        .step h3 { font-size: 15.5px; font-weight: 650; margin: 12px 0 8px; }
        .step p { font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); margin: 0; }

        /* ---------- Download ---------- */
        .download .dl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; max-width: 860px; margin: 0 auto; }
        .dl-card {
          display: flex; align-items: center; gap: 14px; text-decoration: none;
          background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px;
          transition: border-color .18s ease, background .18s ease;
        }
        .dl-card:hover { border-color: var(--accent-line); background: color-mix(in srgb, var(--surface), var(--accent) 4%); }
        .dl-card.web { border-style: dashed; }
        .dl-ic {
          flex: none; width: 46px; height: 46px; border-radius: 8px; display: grid; place-items: center; color: var(--accent);
          background: var(--accent-soft); border: 1px solid var(--accent-line);
        }
        .dl-text { display: flex; flex-direction: column; line-height: 1.3; }
        .dl-text strong { font-size: 15px; font-weight: 650; }
        .dl-text span { font-size: 12px; color: var(--text-secondary); font-family: var(--mono); }
        .dl-go { margin-left: auto; font-size: 16px; color: var(--accent); font-weight: 700; }
        .dl-note { text-align: center; font-size: 13.5px; color: var(--text-secondary); margin: 28px auto 0; max-width: 60ch; line-height: 1.75; }
        .dl-note code { background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 12.5px; font-family: var(--mono); }
        .dl-note a { color: var(--accent); text-decoration: none; font-weight: 600; }
        .dl-note a:hover { text-decoration: underline; }

        /* ---------- Footer ---------- */
        .footer { border-top: 1px solid var(--border); padding: 48px 0 28px; background: var(--surface); }
        .footer-inner { display: flex; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
        .f-logo { font-family: var(--serif); font-size: 21px; font-weight: 600; color: var(--text); }
        .f-brand p { color: var(--text-secondary); font-size: 14px; margin: 8px 0 0; max-width: 36ch; }
        .f-links { display: flex; flex-wrap: wrap; gap: 8px 24px; align-content: flex-start; }
        .f-links a { color: var(--text-secondary); text-decoration: none; font-size: 14px; }
        .f-links a:hover { color: var(--accent); }
        .f-bottom {
          display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border);
          font-size: 12px; color: var(--text-secondary); font-family: var(--mono);
        }

        /* ---------- Responsive ---------- */
        @media (max-width: 960px) {
          .grid { grid-template-columns: repeat(2, 1fr); }
          .steps { grid-template-columns: repeat(2, 1fr); }
          .dpoints { grid-template-columns: repeat(2, 1fr); }
          .download .dl-grid { grid-template-columns: 1fr; max-width: 460px; }
        }
        @media (max-width: 720px) {
          .lnav-links { display: none; }
          .wordmark { font-size: 17px; }
        }
        @media (max-width: 560px) {
          .hero { padding: 44px 0 28px; }
          .grid { grid-template-columns: 1fr; }
          .steps { grid-template-columns: 1fr; }
          .dpoints { grid-template-columns: 1fr; }
          .compare { grid-template-columns: 1fr; }
          .btn { width: 100%; justify-content: center; }
          .cta-row { flex-direction: column; }
          .lnav-gh { display: none; }
        }
      `}</style>
    </div>
  );
}
