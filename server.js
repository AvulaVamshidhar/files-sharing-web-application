const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Storage Configuration ──────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// In-memory store for share sessions
// Structure: { shareId: { id, files: [{originalName, storedName, size, mimetype}], createdAt, expiresAt } }
const shareStore = new Map();

// File expiration time (24 hours in milliseconds)
const EXPIRATION_MS = 24 * 60 * 60 * 1000;

// Max total upload size: 500MB
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

// ─── Multer Setup ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const shareId = req.shareId || uuidv4().split('-')[0].toUpperCase();
    req.shareId = shareId;

    const shareDir = path.join(UPLOADS_DIR, shareId);
    if (!fs.existsSync(shareDir)) {
      fs.mkdirSync(shareDir, { recursive: true });
    }
    cb(null, shareDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename but add uuid prefix to avoid conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const storedName = `${uniqueSuffix}_${base}${ext}`;
    cb(null, storedName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_TOTAL_SIZE,
    files: 50
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Cleanup expired shares ─────────────────────────────────────────────────────
function cleanupExpiredShares() {
  const now = Date.now();
  for (const [shareId, session] of shareStore.entries()) {
    if (now > session.expiresAt) {
      // Remove files from disk
      const shareDir = path.join(UPLOADS_DIR, shareId);
      if (fs.existsSync(shareDir)) {
        fs.rmSync(shareDir, { recursive: true, force: true });
      }
      shareStore.delete(shareId);
      console.log(`🗑️  Cleaned up expired share: ${shareId}`);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredShares, 10 * 60 * 1000);

// ─── API Routes ──────────────────────────────────────────────────────────────────

// Upload files
app.post('/api/upload', (req, res) => {
  upload.array('files', 50)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum is 50 files.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(500).json({ error: 'Upload failed. Please try again.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const shareId = req.shareId;
    const files = req.files.map(f => ({
      originalName: f.originalname,
      storedName: f.filename,
      size: f.size,
      mimetype: f.mimetype
    }));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    const session = {
      id: shareId,
      files,
      totalSize,
      fileCount: files.length,
      createdAt: Date.now(),
      expiresAt: Date.now() + EXPIRATION_MS
    };

    shareStore.set(shareId, session);

    const shareUrl = `${req.protocol}://${req.get('host')}/download.html?code=${shareId}`;

    console.log(`📦 New share created: ${shareId} (${files.length} files, ${formatBytes(totalSize)})`);

    res.json({
      success: true,
      shareId,
      shareUrl,
      fileCount: files.length,
      totalSize,
      expiresIn: '24 hours'
    });
  });
});

// Get share info
app.get('/api/share/:shareId', (req, res) => {
  const { shareId } = req.params;
  const session = shareStore.get(shareId.toUpperCase());

  if (!session) {
    return res.status(404).json({ error: 'Share not found or has expired.' });
  }

  if (Date.now() > session.expiresAt) {
    cleanupExpiredShares();
    return res.status(410).json({ error: 'This share has expired.' });
  }

  const timeRemaining = session.expiresAt - Date.now();

  res.json({
    id: session.id,
    files: session.files.map(f => ({
      name: f.originalName,
      size: f.size,
      type: f.mimetype
    })),
    fileCount: session.fileCount,
    totalSize: session.totalSize,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    timeRemaining
  });
});

// Download a single file
app.get('/api/download/:shareId/:fileName', (req, res) => {
  const { shareId, fileName } = req.params;
  const session = shareStore.get(shareId.toUpperCase());

  if (!session) {
    return res.status(404).json({ error: 'Share not found or has expired.' });
  }

  if (Date.now() > session.expiresAt) {
    return res.status(410).json({ error: 'This share has expired.' });
  }

  const file = session.files.find(f => f.originalName === fileName);
  if (!file) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const filePath = path.join(UPLOADS_DIR, shareId.toUpperCase(), file.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server.' });
  }

  res.download(filePath, file.originalName);
});

// Download all files as ZIP
app.get('/api/download-all/:shareId', (req, res) => {
  const { shareId } = req.params;
  const session = shareStore.get(shareId.toUpperCase());

  if (!session) {
    return res.status(404).json({ error: 'Share not found or has expired.' });
  }

  if (Date.now() > session.expiresAt) {
    return res.status(410).json({ error: 'This share has expired.' });
  }

  const archive = archiver('zip', { zlib: { level: 5 } });
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="FileShare-${shareId}.zip"`);

  archive.pipe(res);

  for (const file of session.files) {
    const filePath = path.join(UPLOADS_DIR, shareId.toUpperCase(), file.storedName);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: file.originalName });
    }
  }

  archive.finalize();
});

// ─── Serve Pages ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/download', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// ─── Helper ──────────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ─── Start Server ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║       🚀 FileShare App is running!       ║`);
  console.log(`  ║                                          ║`);
  console.log(`  ║   Local:  http://localhost:${PORT}          ║`);
  console.log(`  ║                                          ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
