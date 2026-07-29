import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

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

console.log('Paperframe smoke tests passed');
