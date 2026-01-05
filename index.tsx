import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 环境样式加载策略 / Environment Style Loading Strategy
// 1. Electron: 动态导入本地 CSS (包含 PostCSS 构建的 Tailwind 和自定义样式)，确保离线可用且样式完整。
// 2. Web Preview: 跳过本地 CSS 导入，完全依赖 index.html 中注入的 Tailwind CDN。
const isElectron = navigator.userAgent.indexOf('Electron') !== -1;

const mountApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Could not find root element to mount to");
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // Fade out and remove the loader after app is mounted
  const loader = document.getElementById('app-loader');
  if (loader) {
    // Small delay to ensure First Paint happens
    setTimeout(() => {
        loader.style.opacity = '0';
        loader.style.visibility = 'hidden';
        setTimeout(() => {
            loader.remove();
        }, 400); // Matches CSS transition duration
    }, 100);
  }
};

if (isElectron) {
  // Use dynamic import promise to wait for styles
  import('./index.css')
    .then(() => {
      console.log('Local CSS loaded');
      mountApp();
    })
    .catch((err) => {
      console.error('Failed to load local CSS', err);
      // Ensure app still mounts even if CSS fails
      mountApp();
    });
} else {
  // In Web Preview, styles are injected via synchronous scripts in index.html
  mountApp();
}