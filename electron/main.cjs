const { app, BrowserWindow, shell, ipcMain } = require('electron');
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
let mainWindow;
const printPreviewFiles = new Set();

ipcMain.handle('paperframe-open-print-preview', async (_event, bytes) => {
  try {
    const data = Buffer.from(bytes);
    if (!data.length || data.length > 500 * 1024 * 1024) throw Error('Invalid print document');
    const filePath = path.join(app.getPath('temp'), `paperframe-print-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, data); printPreviewFiles.add(filePath);
    const error = await shell.openPath(filePath);
    if (error) throw Error(error);
    return { ok: true };
  } catch (error) { log(`print preview failure: ${error.stack || error}`); return { ok: false, error: error.message }; }
});

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

async function openPdfInEditor(window, filePath) {
  log(`Open PDF request: path=${filePath || 'none'} exists=${Boolean(filePath && fs.existsSync(filePath))}`);
  if (!filePath || !/\.pdf$/i.test(filePath) || !fs.existsSync(filePath)) return;
  app.addRecentDocument(filePath);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('PDF tools'))?.click()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  window.webContents.send('paperframe-open-pdf', { name: path.basename(filePath), bytes: fs.readFileSync(filePath) });
  log(`Opened associated PDF: ${filePath}`);
}

async function createWindow(initialPdf) {
  log(`Starting window; packaged=${app.isPackaged}; resources=${process.resourcesPath}; siteRoot=${siteRoot()}`);
  const port = await startLocalServer();
  log(`Local server listening on 127.0.0.1:${port}`);
  const window = new BrowserWindow({
    title: 'Paperframe Studio', width: 1440, height: 900, minWidth: 1050, minHeight: 680,
    backgroundColor: '#f3f4f1', autoHideMenuBar: true,
    icon: path.join(siteRoot(), 'assets', 'paperframe-icon-192.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
  log('Window loaded successfully');
  if (initialPdf) await openPdfInEditor(window, initialPdf);
  if (process.env.PAPERFRAME_TEST_PDF) {
    const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
    await openPdfInEditor(window, process.env.PAPERFRAME_TEST_PDF);
    await pause(3000);
    const pageCount = await window.webContents.executeJavaScript(`document.querySelectorAll('.pro-thumb').length`);
    const failedPages = [];
    if (!pageCount) {
      const diagnostic = await window.webContents.executeJavaScript(`({ title: document.querySelector('.active-tool-title h2')?.textContent, welcome: document.querySelector('.pro-edit-welcome')?.textContent, toast: document.querySelector('.toast')?.textContent })`);
      log(`Automated PDF diagnostic: ${JSON.stringify(diagnostic)}`);
    }
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.pro-thumb')).find(button => button.textContent.trim() === '${pageNumber}')?.click()`);
      await pause(700);
      const bodyText = await window.webContents.executeJavaScript('document.body.innerText');
      if (bodyText.includes('could not be rendered')) failedPages.push(`${pageNumber}:${await window.webContents.executeJavaScript(`document.querySelector('.toast')?.textContent || 'unknown'`)}`);
    }
    log(`Automated PDF test: rendered=${pageCount > 0 && failedPages.length === 0} pages=${pageCount} failedPages=${failedPages.join(' | ') || 'none'}`);
  }
  if (process.env.PAPERFRAME_TEST_PHOTOS) {
    const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
    const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept="image/*"]' });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: Array(16).fill(process.env.PAPERFRAME_TEST_PHOTOS) });
    await pause(2500);
    const screenResult = await window.webContents.executeJavaScript(`({
      photos: document.querySelectorAll('.asset').length,
      sheets: document.querySelectorAll('.print-sheet').length,
      cells: document.querySelectorAll('.print-sheet .photo-cell img').length,
      button: Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Print all'))?.textContent.trim()
    })`);
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    const printResult = await window.webContents.executeJavaScript(`({
      display: getComputedStyle(document.querySelector('.print-pages')).display,
      visibleSheets: Array.from(document.querySelectorAll('.print-sheet')).filter(sheet => getComputedStyle(sheet).visibility === 'visible').length,
      pageBreaks: Array.from(document.querySelectorAll('.print-sheet')).slice(0, -1).every(sheet => ['page', 'always'].includes(getComputedStyle(sheet).breakAfter) || getComputedStyle(sheet).pageBreakAfter === 'always')
    })`);
    log(`Automated photo print test: ${JSON.stringify({ ...screenResult, ...printResult })}`);
    window.webContents.debugger.detach();
  }
  if (process.env.PAPERFRAME_TEST_CONVERTER) {
    const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('PDF tools'))?.click()`);
    await pause(300);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.pdf-tool-card')).find(button => button.querySelector('strong')?.textContent.trim() === 'Convert')?.click()`);
    await pause(300);
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
    const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.batch-converter input[type=file][multiple][accept*=".pdf"]' });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [process.env.PAPERFRAME_TEST_CONVERTER, process.env.PAPERFRAME_TEST_CONVERTER] });
    await pause(800);
    const wordResult = await window.webContents.executeJavaScript(`({
      modes: Array.from(document.querySelectorAll('.batch-converter .edit-kind button')).map(button => button.textContent.trim()),
      queued: document.querySelectorAll('.convert-file').length,
      multiple: document.querySelector('.batch-converter input[type=file][accept*=".pdf"]').multiple,
      action: document.querySelector('.batch-converter .tool-main-action')?.textContent.trim()
    })`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.batch-converter .edit-kind button')).find(button => button.textContent.includes('PDF to PNG'))?.click()`);
    await pause(200);
    const pngResult = await window.webContents.executeJavaScript(`({ resolutions: document.querySelectorAll('.batch-converter select option').length, queuePreserved: document.querySelectorAll('.convert-file').length })`);
    log(`Automated batch converter test: ${JSON.stringify({ ...wordResult, ...pngResult })}`);
    if (process.env.PAPERFRAME_TEST_CONVERTER_RUN === '1') {
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.batch-converter .edit-kind button')).find(button => button.textContent.includes('PDF to Word'))?.click()`);
      const downloadPath = path.join(app.getPath('temp'), 'paperframe-converter-test'); fs.mkdirSync(downloadPath, { recursive: true });
      await window.webContents.debugger.sendCommand('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });
      await window.webContents.executeJavaScript(`document.querySelector('.batch-converter .tool-main-action')?.click()`);
      for (let attempt = 0; attempt < 40; attempt++) {
        await pause(500);
        const complete = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.convert-file em')).every(status => status.textContent === 'Complete')`);
        if (complete) break;
      }
      await pause(1000);
      log(`Automated converter output: ${JSON.stringify(fs.readdirSync(downloadPath).filter(name => !name.endsWith('.crdownload')))}`);
    }
    window.webContents.debugger.detach();
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', (_event, argv) => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); openPdfInEditor(mainWindow, argv.find(argument => /\.pdf$/i.test(argument))); }
});
app.whenReady().then(() => createWindow(process.argv.find(argument => /\.pdf$/i.test(argument)))).catch(error => { log(`startup failure: ${error.stack || error}`); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  if (localServer) localServer.close();
  printPreviewFiles.forEach(filePath => { try { fs.unlinkSync(filePath); } catch {} });
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
