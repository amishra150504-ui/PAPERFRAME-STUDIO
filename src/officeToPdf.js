import { PDFDocument } from 'pdf-lib';
import { jsPDF } from 'jspdf';

const A4 = [595.28, 841.89];
const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const localElements = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const attr = (node, name) => node?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', name) || node?.getAttribute(`w:${name}`) || node?.getAttribute(name);
const safeName = name => name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'converted';

async function imageFileToPdf(file) {
  const document = await PDFDocument.create(), bytes = await file.arrayBuffer();
  const image = /png$/i.test(file.name) || file.type === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  const landscape = image.width > image.height * 1.15, pageSize = landscape ? [A4[1], A4[0]] : A4;
  const page = document.addPage(pageSize), fitted = image.scaleToFit(pageSize[0] - 40, pageSize[1] - 40);
  page.drawImage(image, { x: (pageSize[0] - fitted.width) / 2, y: (pageSize[1] - fitted.height) / 2, width: fitted.width, height: fitted.height });
  return new Blob([await document.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

function wordRunHtml(run) {
  const text = localElements(run, 't').map(node => node.textContent).join(''); if (!text) return '';
  const properties = localElements(run, 'rPr')[0], styles = [];
  if (localElements(properties || run, 'b').length) styles.push('font-weight:700');
  if (localElements(properties || run, 'i').length) styles.push('font-style:italic');
  if (localElements(properties || run, 'u').length) styles.push('text-decoration:underline');
  const size = Number(attr(localElements(properties || run, 'sz')[0], 'val')); if (size) styles.push(`font-size:${Math.max(7, size / 2)}pt`);
  const color = attr(localElements(properties || run, 'color')[0], 'val'); if (color && color !== 'auto') styles.push(`color:#${color}`);
  return `<span style="${styles.join(';')}">${escapeHtml(text)}</span>`;
}

function wordParagraphHtml(paragraph) {
  const styleName = attr(localElements(paragraph, 'pStyle')[0], 'val') || '', text = [...paragraph.children].filter(node => node.localName === 'r').map(wordRunHtml).join('');
  if (!text) return '<div class="word-space"></div>';
  if (/title/i.test(styleName)) return `<h1>${text}</h1>`;
  const heading = styleName.match(/heading\s*([1-6])/i); if (heading) return `<h${heading[1]}>${text}</h${heading[1]}>`;
  const align = attr(localElements(paragraph, 'jc')[0], 'val') || 'left';
  return `<p style="text-align:${align === 'both' ? 'justify' : align}">${text}</p>`;
}

function wordTableHtml(table) {
  const rows = [...table.children].filter(node => node.localName === 'tr').map(row => `<tr>${[...row.children].filter(node => node.localName === 'tc').map(cell => `<td>${[...cell.children].filter(node => node.localName === 'p').map(wordParagraphHtml).join('')}</td>`).join('')}</tr>`).join('');
  return `<table>${rows}</table>`;
}

async function wordFileToPdf(file) {
  const { default: JSZip } = await import('jszip'), zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file('word/document.xml'); if (!entry) throw Error('Only DOCX files are supported');
  const xml = parseXml(await entry.async('text')), body = localElements(xml, 'body')[0];
  const content = [...body.children].map(node => node.localName === 'p' ? wordParagraphHtml(node) : node.localName === 'tbl' ? wordTableHtml(node) : '').join('');
  return htmlToPdf(`<article class="word-document">${content}</article>`, 'portrait');
}

const excelColumn = reference => { const letters = (reference.match(/[A-Z]+/i) || ['A'])[0].toUpperCase(); return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1; };
const excelColor = node => { const rgb = node?.getAttribute('rgb'); return rgb ? `#${rgb.slice(-6)}` : ''; };

async function excelFileToPdf(file) {
  const { default: JSZip } = await import('jszip'), zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbookEntry = zip.file('xl/workbook.xml'); if (!workbookEntry) throw Error('Only XLSX files are supported');
  const sharedEntry = zip.file('xl/sharedStrings.xml'), shared = sharedEntry ? localElements(parseXml(await sharedEntry.async('text')), 'si').map(item => localElements(item, 't').map(node => node.textContent).join('')) : [];
  const stylesEntry = zip.file('xl/styles.xml'), styleXml = stylesEntry ? parseXml(await stylesEntry.async('text')) : null;
  const fonts = styleXml ? localElements(localElements(styleXml, 'fonts')[0], 'font').map(font => ({ bold: localElements(font, 'b').length > 0, italic: localElements(font, 'i').length > 0, size: localElements(font, 'sz')[0]?.getAttribute('val'), color: excelColor(localElements(font, 'color')[0]) })) : [];
  const fills = styleXml ? localElements(localElements(styleXml, 'fills')[0], 'fill').map(fill => excelColor(localElements(fill, 'fgColor')[0])) : [];
  const formats = styleXml ? localElements(localElements(styleXml, 'cellXfs')[0], 'xf').map(xf => ({ font: fonts[Number(xf.getAttribute('fontId'))] || {}, fill: fills[Number(xf.getAttribute('fillId'))] || '', border: Number(xf.getAttribute('borderId')) > 0, align: localElements(xf, 'alignment')[0]?.getAttribute('horizontal') || '' })) : [];
  const workbook = parseXml(await workbookEntry.async('text')), names = localElements(workbook, 'sheet').map(sheet => sheet.getAttribute('name'));
  const sheetFiles = Object.keys(zip.files).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  let widest = 0;
  const sheets = await Promise.all(sheetFiles.map(async (path, sheetIndex) => {
    const xml = parseXml(await zip.file(path).async('text')), cells = localElements(xml, 'c'), rows = new Map();
    cells.forEach(cell => {
      const reference = cell.getAttribute('r'), rowNumber = Number((reference.match(/\d+/) || ['1'])[0]), column = excelColumn(reference), type = cell.getAttribute('t');
      let value = localElements(cell, 'v')[0]?.textContent ?? '';
      if (type === 's') value = shared[Number(value)] ?? value;
      if (type === 'inlineStr') value = localElements(cell, 't').map(node => node.textContent).join('');
      const style = formats[Number(cell.getAttribute('s') || 0)] || {};
      if (!rows.has(rowNumber)) rows.set(rowNumber, []); rows.get(rowNumber)[column] = { value, style };
      widest = Math.max(widest, column + 1);
    });
    const maxColumns = Math.max(1, ...[...rows.values()].map(row => row.length));
    const htmlRows = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => `<tr>${Array.from({ length: maxColumns }, (_, column) => { const cell = row[column] || { value: '', style: {} }, style = cell.style; return `<td style="${style.fill ? `background:${style.fill};` : ''}${style.bold ? 'font-weight:700;' : ''}${style.font?.bold ? 'font-weight:700;' : ''}${style.font?.italic ? 'font-style:italic;' : ''}${style.font?.color ? `color:${style.font.color};` : ''}${style.font?.size ? `font-size:${style.font.size}pt;` : ''}${style.border ? 'border:1px solid #555;' : ''}${style.align ? `text-align:${style.align};` : ''}">${escapeHtml(cell.value)}</td>`; }).join('')}</tr>`).join('');
    return `<section class="excel-sheet"><h2>${escapeHtml(names[sheetIndex] || `Sheet ${sheetIndex + 1}`)}</h2><table>${htmlRows}</table></section>`;
  }));
  return htmlToPdf(`<article class="excel-document">${sheets.join('')}</article>`, widest > 8 ? 'landscape' : 'portrait');
}

async function htmlToPdf(content, orientation) {
  const host = document.createElement('div'); host.className = 'office-pdf-stage'; host.innerHTML = content; document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation, compress: true });
    await pdf.html(host, { margin: [28, 28, 28, 28], autoPaging: 'text', width: orientation === 'landscape' ? 785 : 539, windowWidth: orientation === 'landscape' ? 1120 : 794, html2canvas: { scale: 1, backgroundColor: '#ffffff', useCORS: true } });
    return pdf.output('blob');
  } finally { host.remove(); }
}

export function acceptedInput(mode) {
  if (mode === 'jpeg-pdf') return '.jpeg';
  if (mode === 'jpg-pdf') return '.jpg';
  if (mode === 'png-pdf') return '.png,image/png';
  if (mode === 'word-pdf') return '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (mode === 'excel-pdf') return '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return '.pdf,application/pdf';
}

export async function convertInputToPdf(file, mode) {
  const blob = mode === 'word-pdf' ? await wordFileToPdf(file) : mode === 'excel-pdf' ? await excelFileToPdf(file) : await imageFileToPdf(file);
  return { name: `${safeName(file.name)}.pdf`, blob };
}
