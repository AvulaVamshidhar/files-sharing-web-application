/* ═══════════════════════════════════════════════════════════════════════════════
   FileShare — Upload Page Logic
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM Elements ───────────────────────────────────────────────────────────
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const fileList = document.getElementById('file-list');
  const uploadFooter = document.getElementById('upload-footer');
  const statsCount = document.getElementById('stats-count');
  const statsSize = document.getElementById('stats-size');
  const btnClear = document.getElementById('btn-clear');
  const btnUpload = document.getElementById('btn-upload');
  const progressWrapper = document.getElementById('progress-wrapper');
  const progressFill = document.getElementById('progress-fill');
  const progressStatus = document.getElementById('progress-status');
  const progressPercent = document.getElementById('progress-percent');
  const uploadSection = document.getElementById('upload-section');
  const shareResult = document.getElementById('share-result');
  const shareCodeValue = document.getElementById('share-code-value');
  const shareLinkUrl = document.getElementById('share-link-url');
  const resultFileCount = document.getElementById('result-file-count');
  const resultTotalSize = document.getElementById('result-total-size');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const btnNewUpload = document.getElementById('btn-new-upload');
  const toastContainer = document.getElementById('toast-container');

  // ─── State ──────────────────────────────────────────────────────────────────
  let selectedFiles = [];

  // ─── File Type Helpers ──────────────────────────────────────────────────────
  const FILE_ICONS = {
    image: { icon: '🖼️', className: 'file-item__icon--image' },
    video: { icon: '🎬', className: 'file-item__icon--video' },
    audio: { icon: '🎵', className: 'file-item__icon--audio' },
    pdf: { icon: '📄', className: 'file-item__icon--document' },
    document: { icon: '📝', className: 'file-item__icon--document' },
    spreadsheet: { icon: '📊', className: 'file-item__icon--document' },
    archive: { icon: '📦', className: 'file-item__icon--archive' },
    code: { icon: '💻', className: 'file-item__icon--code' },
    default: { icon: '📎', className: '' }
  };

  function getFileType(file) {
    const mime = file.type || '';
    const ext = file.name.split('.').pop().toLowerCase();

    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return 'document';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'spreadsheet';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
    if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'xml', 'rb', 'go', 'rs', 'php'].includes(ext)) return 'code';
    return 'default';
  }

  function getFileIconInfo(file) {
    return FILE_ICONS[getFileType(file)] || FILE_ICONS.default;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ─── Toast System ──────────────────────────────────────────────────────────exit
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

  // ─── Drag & Drop ───────────────────────────────────────────────────────────
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dropzone--active');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dropzone--active');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files];
    addFiles(files);
  });

  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    addFiles(files);
    fileInput.value = ''; // reset so same file can be re-selected
  });

  // ─── File Management ───────────────────────────────────────────────────────
  function addFiles(files) {
    const MAX_FILES = 50;
    const MAX_SIZE = 500 * 1024 * 1024;

    for (const file of files) {
      if (selectedFiles.length >= MAX_FILES) {
        showToast(`Maximum ${MAX_FILES} files allowed.`, 'error');
        break;
      }

      // Check for duplicates
      const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
      if (isDuplicate) {
        showToast(`"${file.name}" is already added.`, 'info');
        continue;
      }

      selectedFiles.push(file);
    }

    const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_SIZE) {
      showToast('Total size exceeds 500MB limit.', 'error');
      // Remove last added files that caused overflow
      while (selectedFiles.reduce((s, f) => s + f.size, 0) > MAX_SIZE && selectedFiles.length > 0) {
        selectedFiles.pop();
      }
    }

    renderFileList();
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
  }

  function clearAllFiles() {
    selectedFiles = [];
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = '';

    if (selectedFiles.length === 0) {
      uploadFooter.style.display = 'none';
      return;
    }

    uploadFooter.style.display = 'flex';

    selectedFiles.forEach((file, index) => {
      const iconInfo = getFileIconInfo(file);
      const item = document.createElement('div');
      item.className = 'file-item';
      item.style.animationDelay = `${index * 0.05}s`;

      item.innerHTML = `
        <div class="file-item__icon ${iconInfo.className}">${iconInfo.icon}</div>
        <div class="file-item__info">
          <div class="file-item__name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-item__meta">${formatBytes(file.size)} • ${file.type || 'Unknown type'}</div>
        </div>
        <button class="file-item__remove" data-index="${index}" title="Remove file" type="button">✕</button>
      `;

      fileList.appendChild(item);
    });

    // Attach remove handlers
    fileList.querySelectorAll('.file-item__remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        removeFile(idx);
      });
    });

    // Update stats
    const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    statsCount.textContent = selectedFiles.length;
    statsSize.textContent = formatBytes(totalSize);
  }

  // ─── Upload Logic ──────────────────────────────────────────────────────────
  async function uploadFiles() {
    if (selectedFiles.length === 0) {
      showToast('Please select files to share.', 'error');
      return;
    }

    // Disable button & show progress
    btnUpload.disabled = true;
    btnUpload.innerHTML = '<span class="spinner"></span> Uploading...';
    progressWrapper.classList.add('active');
    progressFill.style.width = '0%';

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = percent + '%';
          progressPercent.textContent = percent + '%';
          progressStatus.textContent = percent < 100 ? 'Uploading...' : 'Processing...';
        }
      });

      const result = await new Promise((resolve, reject) => {
        xhr.open('POST', '/api/upload');

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || 'Upload failed'));
          }
        };

        xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
        xhr.send(formData);
      });

      // Success!
      progressFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressStatus.textContent = 'Complete!';

      showShareResult(result);
      showToast('Files shared successfully! 🎉');

    } catch (err) {
      showToast(err.message || 'Upload failed. Please try again.', 'error');
      btnUpload.disabled = false;
      btnUpload.innerHTML = '🚀 Share Files';
      progressWrapper.classList.remove('active');
    }
  }

  function showShareResult(result) {
    uploadSection.style.display = 'none';
    shareResult.classList.add('active');

    shareCodeValue.textContent = result.shareId;
    shareLinkUrl.textContent = result.shareUrl;
    resultFileCount.textContent = result.fileCount;
    resultTotalSize.textContent = formatBytes(result.totalSize);
  }

  function resetUpload() {
    selectedFiles = [];
    fileList.innerHTML = '';
    uploadFooter.style.display = 'none';
    progressWrapper.classList.remove('active');
    progressFill.style.width = '0%';
    btnUpload.disabled = false;
    btnUpload.innerHTML = '🚀 Share Files';

    shareResult.classList.remove('active');
    uploadSection.style.display = 'block';
  }

  // ─── Copy to Clipboard ─────────────────────────────────────────────────────
  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard!`);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(`${label} copied to clipboard!`);
    }
  }

  // ─── Utility ────────────────────────────────────────────────────────────────
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // ─── Event Listeners ───────────────────────────────────────────────────────
  btnClear.addEventListener('click', clearAllFiles);
  btnUpload.addEventListener('click', uploadFiles);
  btnNewUpload.addEventListener('click', resetUpload);

  btnCopyCode.addEventListener('click', () => {
    copyToClipboard(shareCodeValue.textContent, 'Share code');
  });

  btnCopyLink.addEventListener('click', () => {
    copyToClipboard(shareLinkUrl.textContent, 'Share link');
  });

  // Prevent default drag behavior on page
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    document.body.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

})();
