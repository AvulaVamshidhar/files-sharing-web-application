/* ═══════════════════════════════════════════════════════════════════════════════
   FileShare — Download Page Logic
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM Elements ───────────────────────────────────────────────────────────
  const lookupForm = document.getElementById('lookup-form');
  const codeInput = document.getElementById('code-input');
  const btnLookup = document.getElementById('btn-lookup');
  const downloadSection = document.getElementById('download-section');
  const downloadTitle = document.getElementById('download-title');
  const downloadMeta = document.getElementById('download-meta');
  const downloadFilesList = document.getElementById('download-files-list');
  const btnDownloadAll = document.getElementById('btn-download-all');
  const expiryBadge = document.getElementById('expiry-badge');
  const expiryText = document.getElementById('expiry-text');
  const errorState = document.getElementById('error-state');
  const errorTitle = document.getElementById('error-title');
  const errorDesc = document.getElementById('error-desc');
  const btnTryAgain = document.getElementById('btn-try-again');
  const toastContainer = document.getElementById('toast-container');

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentShareId = null;
  let expiryInterval = null;

  // ─── File Type Helpers ──────────────────────────────────────────────────────
  const FILE_ICONS = {
    image: '🖼️', video: '🎬', audio: '🎵',
    pdf: '📄', document: '📝', spreadsheet: '📊',
    archive: '📦', code: '💻', default: '📎'
  };

  function getFileIcon(name, type) {
    const ext = name.split('.').pop().toLowerCase();
    if (type && type.startsWith('image/')) return FILE_ICONS.image;
    if (type && type.startsWith('video/')) return FILE_ICONS.video;
    if (type && type.startsWith('audio/')) return FILE_ICONS.audio;
    if (type === 'application/pdf' || ext === 'pdf') return FILE_ICONS.pdf;
    if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return FILE_ICONS.document;
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FILE_ICONS.spreadsheet;
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return FILE_ICONS.archive;
    if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'xml', 'rb', 'go', 'rs', 'php'].includes(ext)) return FILE_ICONS.code;
    return FILE_ICONS.default;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Expired';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // ─── Toast System ──────────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__text">${message}</span>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--exiting');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ─── Lookup Share ──────────────────────────────────────────────────────────
  async function lookupShare(code) {
    code = code.trim().toUpperCase();
    if (!code) {
      showToast('Please enter a share code.', 'error');
      return;
    }

    btnLookup.disabled = true;
    btnLookup.innerHTML = '<span class="spinner"></span> Searching...';

    try {
      const response = await fetch(`/api/share/${encodeURIComponent(code)}`);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Share not found.');
      }

      const data = await response.json();
      currentShareId = data.id;
      showDownloadSection(data);

    } catch (err) {
      showError(err.message);
    } finally {
      btnLookup.disabled = false;
      btnLookup.innerHTML = '🔍 Find Files';
    }
  }

  // ─── Render Download Section ───────────────────────────────────────────────
  function showDownloadSection(data) {
    // Hide error, show download section
    errorState.style.display = 'none';
    downloadSection.classList.add('active');

    // Header info
    downloadTitle.textContent = `Shared Files (${data.fileCount})`;
    downloadMeta.textContent = `${data.fileCount} file${data.fileCount > 1 ? 's' : ''} • ${formatBytes(data.totalSize)} total`;

    // Expiry timer
    updateExpiry(data.expiresAt);
    if (expiryInterval) clearInterval(expiryInterval);
    expiryInterval = setInterval(() => updateExpiry(data.expiresAt), 60000);

    // Render file list
    downloadFilesList.innerHTML = '';

    data.files.forEach((file, index) => {
      const icon = getFileIcon(file.name, file.type);
      const item = document.createElement('div');
      item.className = 'download-file';
      item.style.animationDelay = `${index * 0.06}s`;

      item.innerHTML = `
        <div class="download-file__icon">${icon}</div>
        <div class="download-file__info">
          <div class="download-file__name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="download-file__size">${formatBytes(file.size)}</div>
        </div>
        <div class="download-file__action">
          <button class="btn btn--secondary btn--sm" data-filename="${escapeHtml(file.name)}" type="button">
            ⬇️ Download
          </button>
        </div>
      `;

      downloadFilesList.appendChild(item);
    });

    // Attach individual download handlers
    downloadFilesList.querySelectorAll('[data-filename]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fileName = btn.dataset.filename;
        downloadFile(currentShareId, fileName);
      });
    });

    showToast(`Found ${data.fileCount} shared file${data.fileCount > 1 ? 's' : ''}!`);
  }

  function updateExpiry(expiresAt) {
    const remaining = expiresAt - Date.now();
    expiryText.textContent = formatTimeRemaining(remaining);

    if (remaining <= 0) {
      expiryBadge.style.background = 'rgba(255, 107, 107, 0.1)';
      expiryBadge.style.borderColor = 'rgba(255, 107, 107, 0.2)';
      expiryBadge.style.color = '#ff6b6b';
    }
  }

  function showError(message) {
    downloadSection.classList.remove('active');
    errorState.style.display = 'block';

    if (message.includes('expired')) {
      errorTitle.textContent = 'Share Expired';
      errorDesc.textContent = 'These files have expired and are no longer available. Files are automatically deleted after 24 hours.';
    } else {
      errorTitle.textContent = 'Share Not Found';
      errorDesc.textContent = message || 'The share code might be incorrect or the files may have expired.';
    }
  }

  // ─── Download Triggers ─────────────────────────────────────────────────────
  function downloadFile(shareId, fileName) {
    const url = `/api/download/${encodeURIComponent(shareId)}/${encodeURIComponent(fileName)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloading "${fileName}"...`, 'info');
  }

  function downloadAllFiles() {
    if (!currentShareId) return;
    const url = `/api/download-all/${encodeURIComponent(currentShareId)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `FileShare-${currentShareId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Downloading all files as ZIP...', 'info');
  }

  // ─── Event Listeners ───────────────────────────────────────────────────────
  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    lookupShare(codeInput.value);
  });

  btnDownloadAll.addEventListener('click', downloadAllFiles);

  btnTryAgain.addEventListener('click', () => {
    errorState.style.display = 'none';
    downloadSection.classList.remove('active');
    codeInput.value = '';
    codeInput.focus();
  });

  // Auto-uppercase the code input
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  // ─── Auto-lookup if code is in URL ─────────────────────────────────────────
  function checkUrlForCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      codeInput.value = code.toUpperCase();
      lookupShare(code);
    }
  }

  // Run on page load
  checkUrlForCode();

})();
