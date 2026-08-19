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
const normalized = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function tokenRows(items) {
  const tokens = items.filter(item => item.str?.trim()).map(item => ({
    text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width || 0,
    end: item.transform[4] + (item.width || 0), height: Math.abs(item.transform[3]) || 10,
    fontName: item.fontName || ''
  })).sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x), rows = [];
  tokens.forEach(token => {
    let row = rows.find(entry => Math.abs(entry.y - token.y) <= Math.max(3, token.height * .35));
    if (!row) { row = { y: token.y, height: token.height, tokens: [] }; rows.push(row); }
    row.tokens.push(token); row.height = Math.max(row.height, token.height);
  });
  return rows.sort((a, b) => b.y - a.y).map(row => ({ ...row, tokens: row.tokens.sort((a, b) => a.x - b.x) }));
}

function visualCells(row) {
  const cells = [];
  row.tokens.forEach(token => {
    const previous = cells[cells.length - 1], gap = previous ? token.x - previous.end : Infinity;
    if (previous && gap < Math.max(10, token.height * 1.15)) {
      previous.text += `${gap > token.height * .18 ? ' ' : ''}${token.text}`; previous.end = token.end;
    } else cells.push({ text: token.text, x: token.x, end: token.end });
  });
  return cells;
}

const headerDefinitions = [
  { name: 'DATE', patterns: [/^DATE$/] },
  { name: 'CH NO', patterns: [/^CH\s*(NO|NUMBER)$/] },
  { name: 'DEALER', patterns: [/^DEALER$/] },
  { name: 'TRUCK NO', patterns: [/^(TRUCK|VEHICLE)\s*(NO|NUMBER)$/] },
  { name: 'JARI', patterns: [/^JARI$/] },
  { name: 'PAPER', patterns: [/^PAPER$/] },
  { name: 'TOTAL', patterns: [/^(GRAND\s*)?TOTAL$/] }
];

function headerMatches(row) {
  const matches = [];
  for (let start = 0; start < row.tokens.length; start++) {
    for (let length = Math.min(3, row.tokens.length - start); length >= 1; length--) {
      const group = row.tokens.slice(start, start + length), text = normalized(group.map(token => token.text).join(' '));
      const definition = headerDefinitions.find(entry => entry.patterns.some(pattern => pattern.test(text)));
      if (definition && !matches.some(match => match.name === definition.name)) {
        matches.push({ name: definition.name, x: group[0].x, end: group.at(-1).end, center: (group[0].x + group.at(-1).end) / 2 }); break;
      }
    }
  }
  return matches.sort((a, b) => a.x - b.x);
}

function joinBandTokens(tokens) {
  let value = '', previous = null;
  tokens.forEach(token => {
    const gap = previous ? token.x - previous.end : 0;
    value += `${previous && gap > Math.max(1.5, token.height * .08) ? ' ' : ''}${token.text}`; previous = token;
  });
  return value.trim();
}

function detectTable(rows, pageWidth = 612) {
  let best = null;
  rows.forEach((row, index) => {
    const matches = headerMatches(row);
    if (!best || matches.length > best.matches.length) best = { index, row, matches };
  });
  if (!best || best.matches.length < 3) return null;

  // Header x positions are substantially more reliable than whitespace because values may be right aligned.
  const anchors = best.matches.map(match => ({ ...match }));
  const boundaries = [Math.max(0, anchors[0].x - 8)];
  for (let index = 0; index < anchors.length - 1; index++) boundaries.push((anchors[index].center + anchors[index + 1].center) / 2);
  boundaries.push(Math.min(pageWidth, anchors.at(-1).end + Math.max(30, pageWidth * .08)));
  const titleRows = rows.slice(0, best.index).filter(row => row.tokens.length);
  const title = titleRows.length ? joinBandTokens(titleRows.at(-1).tokens) : '';
  const data = [], ambiguous = [];

  for (let rowIndex = best.index + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex], values = anchors.map(() => ''), groups = anchors.map(() => []);
    row.tokens.forEach(token => {
      const center = token.x + token.width / 2;
      let column = boundaries.findIndex((boundary, index) => index < boundaries.length - 1 && center >= boundary && center < boundaries[index + 1]);
      if (column < 0) column = center < boundaries[0] ? 0 : anchors.length - 1;
      groups[column].push(token);
    });
    groups.forEach((tokens, index) => { values[index] = joinBandTokens(tokens); });
    if (!values.some(Boolean)) continue;
    const totalText = normalized(values.join(' '));
    const isTotal = /\bTOTAL\b/.test(totalText) && values.filter(Boolean).length <= 4;
    const populated = values.filter(Boolean).length;
    if (!isTotal && populated < Math.max(2, Math.floor(anchors.length / 2))) ambiguous.push(data.length + 1);
    data.push({ values, y: row.y, isTotal, sourceRow: rowIndex });
  }

  const totalIndex = data.findIndex(row => row.isTotal);
  const body = totalIndex >= 0 ? data.slice(0, totalIndex) : data;
  const printedTotal = totalIndex >= 0 ? data[totalIndex] : null;
  const names = anchors.map(anchor => anchor.name);
  const widths = anchors.map((anchor, index) => Math.max(8, Math.min(26, ((boundaries[index + 1] - boundaries[index]) / pageWidth) * 90)));
  return { title, headers: names, anchors, boundaries, widths, rows: body, printedTotal, ambiguous, confidence: Math.min(1, .45 + anchors.length * .075) };
}

function clusterRows(items, pageWidth) {
  const raw = tokenRows(items), table = detectTable(raw, pageWidth);
  return { raw, rows: raw.map(visualCells), table };
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
    const page = await pdf.getPage(pageNumber), content = await page.getTextContent(), viewport = page.getViewport({ scale: 1 });
    let grouped = clusterRows(content.items, viewport.width), imageBlob = null;
    if (!grouped.rows.length && ocr && worker) {
      const result = await worker.recognize(await renderPage(page, 2));
      const raw = result.data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => ({ y: 1000 - index * 15, height: 10, tokens: [{ text: line, x: 0, end: line.length * 6, width: line.length * 6, height: 10 }] }));
      grouped = { raw, rows: raw.map(visualCells), table: null };
    }
    if (includeImages) imageBlob = await new Promise(resolve => renderPage(page, pngScale).then(canvas => canvas.toBlob(resolve, 'image/png')));
    pages.push({ pageNumber, rows: grouped.rows, rawRows: grouped.raw, table: grouped.table, imageBlob, width: viewport.width, height: viewport.height, scanned: !content.items.some(item => item.str?.trim()) }); onPage?.(pageNumber, grouped.table);
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
const dateSerial = value => {
  const match = String(value).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = Date.UTC(year, Number(match[2]) - 1, Number(match[1])); return Math.floor((date - Date.UTC(1899, 11, 30)) / 86400000);
};
const numeric = value => /^-?[\d,]+(?:\.\d+)?$/.test(String(value).trim()) ? Number(String(value).replace(/,/g, '')) : null;
const inlineCell = (ref, value, style = 3) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const numberCell = (ref, value, style = 5) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;

function workbookStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy;@"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/><color rgb="FF000000"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF000000"/></font><font><i/><sz val="9"/><name val="Calibri"/><color rgb="FF666666"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB8CCE4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E5F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" shrinkToFit="1"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top" shrinkToFit="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="2" fontId="2" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" shrinkToFit="1"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function exactTableSheet(page, table, excelMode, validateTotals) {
  const columns = table.headers.length, lastCol = excelColumn(columns), title = table.title || `Page ${page.pageNumber}`;
  const headerRow = 2, firstDataRow = 3, dataRows = table.rows.filter(row => row.values.some(Boolean));
  const totalRow = firstDataRow + dataRows.length, numericColumns = table.headers.map((header, index) => /JARI|PAPER|TOTAL|AMOUNT|QTY|RATE|BALANCE|\bMT\b|BAGS|KG|TON|LIT(RE|ER)/.test(header) ? index : -1).filter(index => index >= 0);
  const dateColumns = table.headers.map((header, index) => /DATE/.test(header) ? index : -1).filter(index => index >= 0);
  const rows = [`<row r="1" ht="21" customHeight="1">${inlineCell('A1', title, 1)}</row>`, `<row r="2" ht="16.5" customHeight="1">${table.headers.map((header, index) => inlineCell(`${excelColumn(index + 1)}2`, header, 2)).join('')}</row>`];
  dataRows.forEach((row, index) => {
    const excelRow = firstDataRow + index, cells = [];
    row.values.forEach((value, column) => {
      const ref = `${excelColumn(column + 1)}${excelRow}`;
      const identityColumn = /CH\s*NO|DEALER|TRUCK|VEHICLE|CODE|ID/.test(table.headers[column]);
      const serial = dateColumns.includes(column) ? dateSerial(value) : null, number = !identityColumn ? numeric(value) : null;
      if (serial !== null) cells.push(numberCell(ref, serial, 6));
      else if (number !== null) cells.push(numberCell(ref, String(value).replace(/,/g, ''), 5));
      else cells.push(inlineCell(ref, value, /CH NO|TRUCK NO/.test(table.headers[column]) ? 4 : 3));
    });
    rows.push(`<row r="${excelRow}" ht="16.5" customHeight="1">${cells.join('')}</row>`);
  });
  const labelEnd = Math.max(1, (numericColumns[0] ?? columns - 2)), labelRange = `A${totalRow}:${excelColumn(labelEnd)}${totalRow}`;
  const totalCells = [inlineCell(`A${totalRow}`, 'TOTAL', 7)];
  for (let column = labelEnd; column < columns; column++) {
    const ref = `${excelColumn(column + 1)}${totalRow}`;
    if (numericColumns.includes(column)) {
      const printed = table.printedTotal?.values[column] ?? '';
      const value = numeric(printed);
      totalCells.push(value !== null ? numberCell(ref, String(printed).replace(/,/g, ''), 8) : inlineCell(ref, printed, 7));
    }
    else totalCells.push(inlineCell(ref, '', 7));
  }
  rows.push(`<row r="${totalRow}" ht="16.5" customHeight="1">${totalCells.join('')}</row>`);
  let checkRow = totalRow;
  if (validateTotals && table.printedTotal && excelMode === 'data') {
    checkRow++;
    const sourceTotals = numericColumns.map(index => numeric(table.printedTotal.values[index])).filter(value => value !== null);
    rows.push(`<row r="${checkRow}" ht="20" customHeight="1">${inlineCell(`A${checkRow}`, sourceTotals.length ? `PDF printed totals: ${sourceTotals.map(value => value.toFixed(2)).join(' · ')} — compare with formula totals above` : 'PDF total row detected — verify formula totals above', 9)}</row>`);
  }
  const nocciLayout = table.headers.join('|') === 'DATE|CH NO|DEALER|TRUCK NO|JARI|PAPER|TOTAL';
  const referenceWidths = nocciLayout ? [13.333333, 9.555556, 14.888889, 19.333333, 12, 11.777778, 12] : null;
  const cols = table.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${(referenceWidths?.[index] ?? Math.max(index === 3 ? 18 : 10, width)).toFixed(6)}" customWidth="1"/>`).join('');
  const filter = excelMode === 'data' ? `<autoFilter ref="A2:${lastCol}${Math.max(2, totalRow - 1)}"/>` : '';
  const noteMerge = checkRow > totalRow ? `<mergeCell ref="A${checkRow}:${lastCol}${checkRow}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${checkRow > totalRow ? 3 : 2}"><mergeCell ref="A1:${lastCol}1"/><mergeCell ref="${labelRange}"/>${noteMerge}</mergeCells>${filter}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="${page.width > page.height ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

function fallbackSheet(page) {
  const rows = page.rows.length ? page.rows : [[{ text: 'No text detected — enable OCR for scanned pages' }]];
  const maxColumns = Math.max(1, ...rows.map(row => row.length)), lastCol = excelColumn(maxColumns);
  const data = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, cellIndex) => {
    const ref = `${excelColumn(cellIndex + 1)}${rowIndex + 1}`, number = numeric(cell.text), serial = dateSerial(cell.text);
    return serial !== null ? numberCell(ref, serial, 6) : number !== null ? numberCell(ref, String(cell.text).replace(/,/g, ''), 5) : inlineCell(ref, cell.text, 3);
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="${maxColumns}" width="18" customWidth="1"/></cols><sheetData>${data}</sheetData><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="${page.width > page.height ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

export async function createExcelWorkbook(file, pages, options = {}) {
  const { default: JSZip } = await import('jszip'), zip = new JSZip(), timestamp = new Date().toISOString(), base = safeBaseName(file.name), excelMode = options.excelMode || 'exact', validateTotals = options.validateTotals !== false;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${pages.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.folder('docProps').file('core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(base)}</dc:title><dc:creator>Paperframe Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created></cp:coreProperties>`);
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${pages.map((page, index) => `<sheet name="Page ${page.pageNumber}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${pages.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  xl.file('styles.xml', workbookStyles());
  const worksheets = xl.folder('worksheets');
  pages.forEach((page, index) => worksheets.file(`sheet${index + 1}.xml`, page.table ? exactTableSheet(page, page.table, excelMode, validateTotals) : fallbackSheet(page)));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function convertPdf(file, mode, options) {
  const pages = await readPages(file, { ...options, includeImages: mode === 'png' }), base = safeBaseName(file.name);
  if (mode === 'word') return [{ name: `${base}.docx`, blob: await createWordDocument(file, pages) }];
  if (mode === 'excel') return [{ name: `${base}.xlsx`, blob: await createExcelWorkbook(file, pages, options), analysis: pages.map(page => page.table ? ({ page: page.pageNumber, columns: page.table.headers.length, rows: page.table.rows.length, confidence: page.table.confidence, ambiguous: page.table.ambiguous.length }) : ({ page: page.pageNumber, columns: 0, rows: page.rows.length, confidence: 0, ambiguous: page.rows.length })) }];
  return pages.map(page => ({ name: `${base}/page-${String(page.pageNumber).padStart(3, '0')}.png`, blob: page.imageBlob }));
}

export async function downloadOutputs(outputs, mode, forceZip = false) {
  if (!forceZip && outputs.length === 1 && mode !== 'png') return downloadBlob(outputs[0].blob, outputs[0].name);
  downloadBlob(await createOutputArchive(outputs), `paperframe-${mode}-batch.zip`);
}

export async function createOutputArchive(outputs) {
  const { default: JSZip } = await import('jszip'), archive = new JSZip();
  await Promise.all(outputs.map(async output => archive.file(output.name, output.blob?.arrayBuffer ? new Uint8Array(await output.blob.arrayBuffer()) : output.blob)));
  return archive.generateAsync({ type: 'blob' });
}
