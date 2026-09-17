const express = require('express');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { put, del, list } = require('@vercel/blob');
const { handleUpload } = require('@vercel/blob/client');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

const EXPIRATION_MS = 24 * 60 * 60 * 1000;
const MAX_FILES = 50;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname + '/public'));

// Vercel Blob client-upload token endpoint.
// The browser uploads the actual file directly to Blob, so large files do
// not pass through the Vercel Function's request-body limit.
app.post('/api/upload', async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        return {
          allowedContentTypes: ['*/*'],
          maximumSizeInBytes: MAX_TOTAL_SIZE,
          addRandomSuffix: false,
          tokenPayload: clientPayload || '',
        };
      },
    });

    res.json(jsonResponse);
  } catch (error) {
    console.error('Blob upload token error:', error);
    res.status(400).json({ error: error.message || 'Unable to prepare upload.' });
  }
});

// Save the share manifest as a small JSON Blob.
// This replaces the old in-memory Map, so share information survives
// serverless function invocations.
app.post('/api/create-share', async (req, res) => {
  try {
    const { files } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No uploaded files were provided.' });
    }

    if (files.length > MAX_FILES) {
      return res.status(400).json({ error: `Maximum is ${MAX_FILES} files.` });
    }

    const cleanFiles = files.map((file) => ({
      originalName: String(file.originalName || ''),
      size: Number(file.size || 0),
      mimetype: String(file.mimetype || 'application/octet-stream'),
      url: String(file.url || ''),
      downloadUrl: String(file.downloadUrl || file.url || ''),
      pathname: String(file.pathname || ''),
    }));

    const totalSize = cleanFiles.reduce((sum, file) => sum + file.size, 0);

    if (cleanFiles.some((file) => !file.originalName || !file.url)) {
      return res.status(400).json({ error: 'Invalid uploaded file information.' });
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      return res.status(400).json({ error: 'Total size exceeds 500MB limit.' });
    }

    const shareId = uuidv4().split('-')[0].toUpperCase();
    const session = {
      id: shareId,
      files: cleanFiles,
      totalSize,
      fileCount: cleanFiles.length,
      createdAt: Date.now(),
      expiresAt: Date.now() + EXPIRATION_MS,
    };

    const manifest = await put(
      `shares/${shareId}.json`,
      JSON.stringify(session),
      {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      }
    );

    const shareUrl = `${req.protocol}://${req.get('host')}/download.html?code=${shareId}`;

    res.json({
      success: true,
      shareId,
      shareUrl,
      fileCount: session.fileCount,
      totalSize: session.totalSize,
      expiresIn: '24 hours',
      manifestUrl: manifest.url,
    });
  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({ error: error.message || 'Could not create share.' });
  }
});

// Resolve a manifest by listing only the share prefix. This avoids needing
// a database while keeping the share metadata persistent.
async function findManifest(shareId) {
  const normalized = String(shareId || '').trim().toUpperCase();

  if (!/^[A-F0-9]{8}$/.test(normalized)) return null;

  const result = await list({ prefix: `shares/${normalized}.json`, limit: 1 });
  if (!result.blobs || result.blobs.length === 0) return null;

  const manifestBlob = result.blobs[0];
  const response = await fetch(manifestBlob.url);

  if (!response.ok) return null;

  const session = await response.json();
  return { session, manifestUrl: manifestBlob.url };
}

async function deleteExpiredSession(found) {
  if (!found) return;
  try {
    await Promise.all([
      ...found.session.files.map((file) => file.url ? del(file.url) : null),
      del(found.manifestUrl),
    ]);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Get share information
app.get('/api/share/:shareId', async (req, res) => {
  try {
    const found = await findManifest(req.params.shareId);

    if (!found) {
      return res.status(404).json({ error: 'Share not found or has expired.' });
    }

    const { session } = found;

    if (Date.now() > session.expiresAt) {
      await deleteExpiredSession(found);
      return res.status(410).json({ error: 'This share has expired.' });
    }

    res.json({
      id: session.id,
      files: session.files.map((file) => ({
        name: file.originalName,
        size: file.size,
        type: file.mimetype,
      })),
      fileCount: session.fileCount,
      totalSize: session.totalSize,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      timeRemaining: session.expiresAt - Date.now(),
    });
  } catch (error) {
    console.error('Share lookup error:', error);
    res.status(500).json({ error: 'Unable to find this share right now.' });
  }
});

// Download one file by redirecting directly to its Blob URL.
app.get('/api/download/:shareId/:fileName', async (req, res) => {
  try {
    const found = await findManifest(req.params.shareId);

    if (!found) {
      return res.status(404).json({ error: 'Share not found or has expired.' });
    }

    if (Date.now() > found.session.expiresAt) {
      await deleteExpiredSession(found);
      return res.status(410).json({ error: 'This share has expired.' });
    }

    const fileName = decodeURIComponent(req.params.fileName);
    const file = found.session.files.find((item) => item.originalName === fileName);

    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.redirect(file.downloadUrl || file.url);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Unable to download this file.' });
  }
});

// Stream all files into a ZIP without writing them to the Vercel filesystem.
app.get('/api/download-all/:shareId', async (req, res) => {
  try {
    const found = await findManifest(req.params.shareId);

    if (!found) {
      return res.status(404).json({ error: 'Share not found or has expired.' });
    }

    if (Date.now() > found.session.expiresAt) {
      await deleteExpiredSession(found);
      return res.status(410).json({ error: 'This share has expired.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="FileShare-${found.session.id}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (error) => {
      console.error('ZIP error:', error);
      if (!res.headersSent) res.status(500);
      res.end();
    });

    archive.pipe(res);

    for (const file of found.session.files) {
      const response = await fetch(file.url);

      if (!response.ok || !response.body) {
        console.warn(`Skipping unavailable file: ${file.originalName}`);
        continue;
      }

      // Node 18+ supports converting a web ReadableStream to a Node stream.
      archive.append(Readable.fromWeb(response.body), {
        name: file.originalName,
      });
    }

    await archive.finalize();
  } catch (error) {
    console.error('Download-all error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to create the ZIP file.' });
    } else {
      res.end();
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/download', (req, res) => {
  res.sendFile(__dirname + '/public/download.html');
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FileShare App running at http://localhost:${PORT}`);
  });
}

module.exports = app;
