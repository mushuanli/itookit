// @file: app-settings/editors/storage/StorageUtils.ts

export const StorageUtils = {
  formatSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2);
  },

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;

    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}分钟前`;
    
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  formatLogTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  },

  truncatePath(path: string, maxLength: number): string {
    if (path.length <= maxLength) return path;
    const parts = path.split('/');
    if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);
    const filename = parts[parts.length - 1];
    if (filename.length >= maxLength - 6) return '.../' + filename.slice(-maxLength + 6);
    return '.../' + parts.slice(-2).join('/');
  },

  escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  downloadJson(data: object | string, filename: string): void {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};
