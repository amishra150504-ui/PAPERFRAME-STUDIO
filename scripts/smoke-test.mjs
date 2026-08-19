import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { createExcelWorkbook, createOutputArchive, createWordDocument, parsePageRange } from '../src/pdfConverters.js';
import { fitImageRect, normalizedRotation, rotatedDimensions, smartExpandSettings } from '../src/photoLayout.js';
import { acceptedInput } from '../src/officeToPdf.js';

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
const first = source.addPage([595.28, 841.89]);
first.drawText('Paperframe smoke test', { x: 50, y: 780, size: 18, font });
source.addPage([841.89, 595.28]);
const sourceBytes = await source.save({ useObjectStreams: true });

const loaded = await PDFDocument.load(sourceBytes);
assert.equal(loaded.getPageCount(), 2, 'PDF page count should survive save/load');

const organized = await PDFDocument.create();
const copied = await organized.copyPages(loaded, [1, 0, 0]);
copied[0].setRotation(degrees(90));
copied.forEach(page => organized.addPage(page));
const organizedBytes = await organized.save({ useObjectStreams: true });
const checked = await PDFDocument.load(organizedBytes);

assert.equal(checked.getPageCount(), 3, 'Organizer should support reorder and duplicate');
assert.equal(checked.getPage(0).getRotation().angle, 90, 'Organizer rotation should persist');
assert.ok(organizedBytes.length > 500, 'Output PDF should contain document data');

const renderTask = pdfjs.getDocument({ data: sourceBytes.slice(), stopAtErrors: false, isEvalSupported: false, useWorkerFetch: false });
const rendered = await renderTask.promise;
const renderedPage = await rendered.getPage(1);
const viewport = renderedPage.getViewport({ scale: 1.15 });
const content = await renderedPage.getTextContent();
assert.equal(rendered.numPages, 2, 'PDF.js should share and inspect the complete document');
assert.ok(viewport.width > 500 && viewport.height > 700, 'PDF.js should calculate a usable page viewport');
assert.ok(content.items.some(item => item.str.includes('Paperframe smoke test')), 'PDF.js should extract native text');
await renderTask.destroy();

assert.deepEqual(parsePageRange('1-2, 4', 5), [1, 2, 4], 'Page ranges should support spans and comma-separated pages');
assert.equal(normalizedRotation(-90), 270, 'Negative photo rotation should normalize correctly');
assert.deepEqual(rotatedDimensions(1200, 800, 90), { width: 800, height: 1200 }, 'A 90-degree rotation should swap image dimensions before fitting');
const rotatedCover = fitImageRect(800, 1200, 95, 133.5, 'cover');
assert.ok(rotatedCover.width >= 95 && rotatedCover.height >= 133.5, 'A rotated cover image must fill the entire target cell');
const rotatedContain = fitImageRect(800, 1200, 95, 133.5, 'contain');
assert.ok(rotatedContain.width <= 95.001 && rotatedContain.height <= 133.501, 'A rotated contained image must remain inside the target cell');
assert.deepEqual(smartExpandSettings({ width: 800, height: 1200, rotation: 0 }, 140, 90, { autoRotate: true }), { fit: 'smart', zoom: 1, x: 0, y: 0, expandX: 1, expandY: 1, rotation: 90 }, 'Smart Expand should preserve the entire image and extend only the missing background');
assert.equal(smartExpandSettings({ width: 800, height: 1200, rotation: 0 }, 140, 90, { autoRotate: false }).rotation, 0, 'Smart Expand must respect disabled auto-rotation');
assert.equal(acceptedInput('jpeg-pdf'), '.jpeg', 'JPEG conversion should select JPEG files only');
assert.match(acceptedInput('word-pdf'), /docx/, 'Word to PDF should accept DOCX documents');
assert.match(acceptedInput('excel-pdf'), /xlsx/, 'Excel to PDF should accept XLSX workbooks');
const convertedPages = [
  { pageNumber: 1, rows: [[{ text: 'Account' }, { text: 'Balance' }], [{ text: 'Cash' }, { text: '1250.00' }]] },
  { pageNumber: 2, rows: [[{ text: 'Second page' }]] }
];
const wordBlob = await createWordDocument({ name: 'conversion-test.pdf' }, convertedPages);
const wordZip = await JSZip.loadAsync(await wordBlob.arrayBuffer());
assert.ok(wordZip.file('word/document.xml'), 'Word conversion should produce a valid DOCX package');
assert.match(await wordZip.file('word/document.xml').async('text'), /Account/, 'Word conversion should preserve extracted text');
const excelBlob = await createExcelWorkbook({ name: 'conversion-test.pdf' }, convertedPages);
const excelZip = await JSZip.loadAsync(await excelBlob.arrayBuffer());
assert.ok(excelZip.file('xl/workbook.xml'), 'Excel conversion should produce a valid XLSX package');
assert.ok(excelZip.file('xl/worksheets/sheet2.xml'), 'Excel conversion should create one worksheet per PDF page');
assert.match(await excelZip.file('xl/worksheets/sheet1.xml').async('text'), /1250\.00/, 'Excel conversion should preserve table cell values');
assert.doesNotMatch(await excelZip.file('xl/worksheets/sheet1.xml').async('text'), /<f(?:\s|>)/, 'Exact Excel conversion must never add formulas');
const separateArchive = await createOutputArchive([{ name: 'first.xlsx', blob: excelBlob }, { name: 'second.docx', blob: wordBlob }]);
const separateZip = await JSZip.loadAsync(await separateArchive.arrayBuffer());
assert.ok(separateZip.file('first.xlsx') && separateZip.file('second.docx'), 'ZIP packaging should preserve converted files separately');

console.log('Paperframe smoke tests passed');
