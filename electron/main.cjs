const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const logPath = path.join(app.getPath('userData'), 'desktop-startup.log');
function log(message) {
  try { fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`); } catch {}
}
process.on('uncaughtException', error => log(`uncaughtException: ${error.stack || error}`));
process.on('unhandledRejection', error => log(`unhandledRejection: ${error?.stack || error}`));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

let localServer;

function siteRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-dist')
    : path.join(__dirname, '..', 'dist');
}

function startLocalServer() {
  const root = path.resolve(siteRoot());
  return new Promise((resolve, reject) => {
    localServer = http.createServer((request, response) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
      catch { response.writeHead(400).end('Bad request'); return; }
      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let filePath = path.resolve(root, requested);
      if (!filePath.startsWith(root + path.sep) && filePath !== root) {
        response.writeHead(403).end('Forbidden'); return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(root, 'index.html');
      fs.readFile(filePath, (error, content) => {
        if (error) { response.writeHead(500).end('Could not load application'); return; }
        response.writeHead(200, {
          'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(content);
      });
    });
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => resolve(localServer.address().port));
  });
}

async function createWindow() {
  log(`Starting window; packaged=${app.isPackaged}; resources=${process.resourcesPath}; siteRoot=${siteRoot()}`);
  const port = await startLocalServer();
  log(`Local server listening on 127.0.0.1:${port}`);
  const window = new BrowserWindow({
    title: 'Paperframe Studio', width: 1440, height: 900, minWidth: 1050, minHeight: 680,
    backgroundColor: '#f3f4f1', autoHideMenuBar: true,
    icon: path.join(siteRoot(), 'assets', 'paperframe-icon-192.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
  log('Window loaded successfully');
}

app.whenReady().then(createWindow).catch(error => { log(`startup failure: ${error.stack || error}`); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (localServer) localServer.close(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
