// CSS加载检测和FOUC防护
export function initCSSLoader() {
  if (typeof window === 'undefined') return;

  // 检测CSS是否已加载
  function checkCSSLoaded() {
    try {
      // 检查CSS变量是否可用
      const testElement = document.createElement('div');
      testElement.style.cssText = 'color: var(--text);';
      document.body.appendChild(testElement);
      
      const computedStyle = window.getComputedStyle(testElement);
      const hasCSS = computedStyle.color !== '' && computedStyle.color !== 'var(--text)';
      
      document.body.removeChild(testElement);
      return hasCSS;
    } catch {
      return false;
    }
  }

  // 如果CSS还没加载，添加加载状态
  if (!checkCSSLoaded()) {
    document.documentElement.style.visibility = 'hidden';
    
    // 监听CSS加载完成
    const checkInterval = setInterval(() => {
      if (checkCSSLoaded()) {
        document.documentElement.style.visibility = 'visible';
        clearInterval(checkInterval);
      }
    }, 10);
    
    // 最多等待1秒，避免无限等待
    setTimeout(() => {
      document.documentElement.style.visibility = 'visible';
      clearInterval(checkInterval);
    }, 1000);
  }
}

// 优化关键CSS加载
export function preloadCriticalCSS() {
  if (typeof window === 'undefined') return;

  // 预加载关键CSS
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'style';
  link.href = '/globals.css';
  link.onload = () => {
    link.rel = 'stylesheet';
  };
  document.head.appendChild(link);
}

// 主题切换时的CSS优化
export function optimizeThemeSwitch() {
  if (typeof window === 'undefined') return;

  // 减少主题切换时的闪烁
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
        document.body.style.transition = 'background-color 0.2s ease, color 0.2s ease';
      }
    });
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}