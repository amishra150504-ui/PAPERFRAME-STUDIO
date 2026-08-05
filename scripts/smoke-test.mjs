import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

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
await rendered.destroy();

console.log('Paperframe smoke tests passed');
