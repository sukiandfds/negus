import { createRoot } from 'react-dom/client';
import { FeishuApp } from './FeishuApp';
import '../../web-ui/src/styles/tokens.css';
import '../../web-ui/src/styles/global.css';
import './style.css';

let viewportFrame = 0;
const resize = () => {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--app-viewport-height', `${window.visualViewport?.height || innerHeight}px`);
    document.documentElement.style.setProperty('--app-viewport-offset-top', `${window.visualViewport?.offsetTop || 0}px`);
  });
};
resize();
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
createRoot(document.getElementById('root')!).render(<FeishuApp />);
