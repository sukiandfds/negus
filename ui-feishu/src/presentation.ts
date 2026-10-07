const palette: Record<string, string> = { researcher: '#5179db', manager: '#19a592', engineer: '#8370d9', risk: '#ca9950' };
export const avatarColor = (id = '') => palette[id] || '#4b87b4';
export const compactTime = (value?: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return date.toLocaleDateString('zh-CN') === new Date().toLocaleDateString('zh-CN')
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};
