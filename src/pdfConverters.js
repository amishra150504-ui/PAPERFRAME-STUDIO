import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export const safeBaseName = name => name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'document';

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function parsePageRange(value, total) {
  if (!value.trim() || value.trim().toLowerCase() === 'all') return Array.from({ length: total }, (_, index) => index + 1);
  const selected = new Set();
  value.split(',').forEach(part => {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!match) return;
    const start = Math.max(1, Math.min(total, Number(match[1]))), end = Math.max(1, Math.min(total, Number(match[2] || match[1])));
    for (let page = Math.min(start, end); page <= Math.max(start, end); page++) selected.add(page);
  });
  return [...selected].sort((a, b) => a - b);
}

const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function clusterRows(items) {
  const tokens = items.filter(item => item.str?.trim()).map(item => ({
    text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width || 0, height: Math.abs(item.transform[3]) || 10
  })).sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x), rows = [];
  tokens.forEach(token => {
    let row = rows.find(entry => Math.abs(entry.y - token.y) <= Math.max(3, token.height * .35));
    if (!row) { row = { y: token.y, tokens: [] }; rows.push(row); }
    row.tokens.push(token);
  });
  return rows.sort((a, b) => b.y - a.y).map(row => {
    const sorted = row.tokens.sort((a, b) => a.x - b.x), cells = [];
    sorted.forEach(token => {
      const previous = cells[cells.length - 1], gap = previous ? token.x - previous.end : Infinity;
      if (previous && gap < Math.max(10, token.height * 1.15)) {
        previous.text += `${gap > token.height * .18 ? ' ' : ''}${token.text}`; previous.end = token.x + token.width;
      } else cells.push({ text: token.text, x: token.x, end: token.x + token.width });
    });
    return cells;
  });
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

export async function countSelectedPages(file, range) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: false, isEvalSupported: false, useWorkerFetch: false });
  const pdf = await task.promise, count = parsePageRange(range, pdf.numPages).length; await task.destroy(); return count;
}

async function readPages(file, { range, ocr, pngScale, worker, onPage, includeImages }) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: false, isEvalSupported: false, useWorkerFetch: false });
  const pdf = await task.promise, selected = parsePageRange(range, pdf.numPages), pages = [];
  if (!selected.length) { await task.destroy(); throw Error('The selected page range is empty'); }
  for (const pageNumber of selected) {
    const page = await pdf.getPage(pageNumber), content = await page.getTextContent(); let rows = clusterRows(content.items), imageBlob = null;
    if (!rows.length && ocr && worker) {
      const result = await worker.recognize(await renderPage(page, 2));
      rows = result.data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => [{ text: line, x: 0 }]);
    }
    if (includeImages) imageBlob = await new Promise(resolve => renderPage(page, pngScale).then(canvas => canvas.toBlob(resolve, 'image/png')));
    pages.push({ pageNumber, rows, imageBlob, scanned: !content.items.some(item => item.str?.trim()) }); onPage?.(pageNumber);
  }
  await task.destroy(); return pages;
}

export async function createWordDocument(file, pages) {
  const { Document, Packer, Paragraph, TextRun, PageBreak, AlignmentType } = await import('docx'), children = [], base = safeBaseName(file.name);
  pages.forEach((page, index) => {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: `${base} — Page ${page.pageNumber}`, bold: true, size: 20, color: '666666' })] }));
    if (!page.rows.length) children.push(new Paragraph({ children: [new TextRun({ text: '[No selectable text found. Enable OCR for scanned pages.]', italics: true, color: '888888' })] }));
    page.rows.forEach(row => children.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: row.map(cell => cell.text).join('\t'), size: 22 })] })));
    if (index < pages.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  return Packer.toBlob(new Document({ creator: 'Paperframe Studio', title: base, sections: [{ properties: {}, children }] }));
}

const excelColumn = number => { let value = '', current = number; while (current > 0) { current--; value = String.fromCharCode(65 + current % 26) + value; current = Math.floor(current / 26); } return value; };

export async function createExcelWorkbook(file, pages) {
  const { default: JSZip } = await import('jszip'), zip = new JSZip(), timestamp = new Date().toISOString(), base = safeBaseName(file.name);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${pages.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.folder('docProps').file('core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(base)}</dc:title><dc:creator>Paperframe Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created></cp:coreProperties>`);
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${pages.map((page, index) => `<sheet name="Page ${page.pageNumber}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`);
  const worksheets = xl.folder('worksheets');
  pages.forEach((page, pageIndex) => {
    const rows = page.rows.length ? page.rows : [[{ text: 'No text detected — enable OCR for scanned pages' }]];
    const sheetData = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, cellIndex) => `<c r="${excelColumn(cellIndex + 1)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`).join('')}</row>`).join('');
    worksheets.file(`sheet${pageIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function convertPdf(file, mode, options) {
  const pages = await readPages(file, { ...options, includeImages: mode === 'png' }), base = safeBaseName(file.name);
  if (mode === 'word') return [{ name: `${base}.docx`, blob: await createWordDocument(file, pages) }];
  if (mode === 'excel') return [{ name: `${base}.xlsx`, blob: await createExcelWorkbook(file, pages) }];
  return pages.map(page => ({ name: `${base}/page-${String(page.pageNumber).padStart(3, '0')}.png`, blob: page.imageBlob }));
}

export async function downloadOutputs(outputs, mode) {
  if (outputs.length === 1 && mode !== 'png') return downloadBlob(outputs[0].blob, outputs[0].name);
  const { default: JSZip } = await import('jszip'), archive = new JSZip();
  outputs.forEach(output => archive.file(output.name, output.blob));
  downloadBlob(await archive.generateAsync({ type: 'blob' }), `paperframe-${mode}-batch.zip`);
}
