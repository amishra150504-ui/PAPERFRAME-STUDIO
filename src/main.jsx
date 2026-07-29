import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlignCenter, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown,
  Copy, Crop, Download, FileImage, FilePlus2, FileText, Grid2X2, Image as ImageIcon,
  Layers3, LoaderCircle, Maximize2, Minus, MoreHorizontal, Move, PanelLeftClose,
  Plus, Printer, Redo2, RefreshCcw, RotateCcw, RotateCw, Scissors, Settings2,
  Sparkles, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut, Paintbrush, FlipHorizontal2,
  FlipVertical2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './styles.css';
import { clearAutosave, loadAutosave, saveAutosave } from './projectStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const A4 = { portrait: [210, 297], landscape: [297, 210] };
const layouts = [
  { cols: 1, rows: 1 }, { cols: 2, rows: 1 }, { cols: 1, rows: 2 },
  { cols: 2, rows: 2 }, { cols: 3, rows: 2 }, { cols: 2, rows: 3 },
  { cols: 4, rows: 2 }, { cols: 2, rows: 4 }, { cols: 3, rows: 3 }
];
const defaultSettings = {
  orientation: 'portrait', cols: 2, rows: 2, marginTop: 10, marginRight: 10,
  marginBottom: 10, marginLeft: 10, gapX: 0, gapY: 0, border: true,
  borderWidth: 0.3, fit: 'cover', background: '#ffffff',
  fixedSize: false, photoWidth: 35, photoHeight: 45
};

function IconButton({ label, children, active, disabled, onClick, className = '' }) {
  return <button title={label} aria-label={label} disabled={disabled} onClick={onClick}
    className={`icon-button ${active ? 'active' : ''} ${className}`}>{children}</button>;
}

function Segmented({ value, onChange, options }) {
  return <div className="segmented">
    {options.map(o => <button key={o.value} className={value === o.value ? 'selected' : ''}
      onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>)}
  </div>;
}

function NumberInput({ label, value, onChange, min = 0, max = 50, step = 1, suffix = 'mm' }) {
  return <label className="number-field">
    <span>{label}</span>
    <span className="input-wrap">
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value))))} />
      <small>{suffix}</small>
    </span>
  </label>;
}

function Toast({ message }) {
  return message ? <div className="toast"><Check size={16} />{message}</div> : null;
}

function EmptyCanvas({ onUpload }) {
  return <div className="empty-canvas">
    <div className="empty-icon"><ImageIcon size={28} /></div>
    <strong>Your page is ready</strong>
    <p>Add photos and they’ll flow into the grid automatically.</p>
    <button className="primary compact" onClick={onUpload}><Upload size={16} /> Choose photos</button>
  </div>;
}

function PhotoCell({ photo, index, settings, selected, onSelect, onDropPhoto, painterActive }) {
  const [dragging, setDragging] = useState(false);
  return <button
    className={`photo-cell ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
    style={{
      border: settings.border ? `${Math.max(settings.borderWidth, .2)}mm solid #2a2b29` : 'none',
      backgroundColor: settings.background
    }}
    onClick={e => onSelect(photo?.id || null, e)}
    onDragOver={e => { e.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); setDragging(false); onDropPhoto(e.dataTransfer.getData('photoId'), index); }}
  >
    {photo ? <>
      <img src={photo.url} alt={photo.name} draggable={false} style={{
        objectFit: photo.fit || settings.fit,
        transform: `translate(${photo.x || 0}%, ${photo.y || 0}%) scale(${(photo.zoom || 1) * (photo.expandX || 1) * (photo.mirrorX ? -1 : 1)}, ${(photo.zoom || 1) * (photo.expandY || 1) * (photo.mirrorY ? -1 : 1)}) rotate(${photo.rotation || 0}deg)`,
        filter: `brightness(${photo.brightness || 100}%) contrast(${photo.contrast || 100}%) saturate(${photo.saturation || 100}%)`
      }} />
      <span className="cell-number">{index + 1}</span>
      {painterActive && <span className="paint-target"><Paintbrush size={13} /> Apply format</span>}
    </> : <span className="empty-cell"><Plus size={15} /> Empty</span>}
  </button>;
}

function PhotoEditorPanel({ photo, selectedCount, onUpdate, onDelete, onDuplicate, onCopyFormat, painterActive }) {
  if (!photo) return <div className="selection-empty">
    <Crop size={22} />
    <strong>Select a photo</strong>
    <p>Click any image on the page to adjust its crop and appearance.</p>
  </div>;
  const slider = (label, key, min, max, step = 1, display = v => v) =>
    <label className="slider-field"><span>{label}<b>{display(photo[key])}</b></span>
      <input type="range" min={min} max={max} step={step} value={photo[key]}
        onChange={e => onUpdate({ [key]: Number(e.target.value) })} /></label>;
  return <div className="photo-controls">
    <div className="selected-photo">
      <img src={photo.url} alt="" />
      <div><strong>{selectedCount > 1 ? `${selectedCount} photos selected` : photo.name}</strong><small>{selectedCount > 1 ? 'Changes apply to all selected photos' : `${photo.width} × ${photo.height} px`}</small></div>
    </div>
    <div className="control-label">Image fit</div>
    <Segmented value={photo.fit} onChange={fit => onUpdate({ fit })} options={[
      { value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }
    ]} />
    {slider('Zoom', 'zoom', 1, 3, .05, v => `${Math.round(v * 100)}%`)}
    {slider('Horizontal', 'x', -50, 50, 1, v => `${v}%`)}
    {slider('Vertical', 'y', -50, 50, 1, v => `${v}%`)}
    <div className="control-label">Expand / compress</div>
    {slider('Width', 'expandX', .5, 2, .05, v => `${Math.round(v * 100)}%`)}
    {slider('Height', 'expandY', .5, 2, .05, v => `${Math.round(v * 100)}%`)}
    <div className="mirror-row">
      <button className={`secondary ${photo.mirrorX ? 'pressed' : ''}`} onClick={() => onUpdate({ mirrorX: !photo.mirrorX })}><FlipHorizontal2 size={15} /> Mirror horizontal</button>
      <button className={`secondary ${photo.mirrorY ? 'pressed' : ''}`} onClick={() => onUpdate({ mirrorY: !photo.mirrorY })}><FlipVertical2 size={15} /> Mirror vertical</button>
    </div>
    <div className="control-label row-label"><span>Rotate</span><span className="toolbar-mini">
      <IconButton label="Rotate left" onClick={() => onUpdate({ rotation: photo.rotation - 90 })}><RotateCcw size={15} /></IconButton>
      <IconButton label="Rotate right" onClick={() => onUpdate({ rotation: photo.rotation + 90 })}><RotateCw size={15} /></IconButton>
    </span></div>
    <div className="divider" />
    {slider('Brightness', 'brightness', 50, 150, 1, v => `${v}%`)}
    {slider('Contrast', 'contrast', 50, 150, 1, v => `${v}%`)}
    {slider('Saturation', 'saturation', 0, 200, 1, v => `${v}%`)}
    <div className="button-row">
      <button className="secondary" onClick={() => onUpdate({ zoom: 1, x: 0, y: 0, expandX: 1, expandY: 1, mirrorX: false, mirrorY: false, rotation: 0, brightness: 100, contrast: 100, saturation: 100 })}><RefreshCcw size={14} /> Reset</button>
      <button className="secondary" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
      <IconButton label="Delete photo" className="danger" onClick={onDelete}><Trash2 size={15} /></IconButton>
    </div>
    <button className={`format-painter ${painterActive ? 'active' : ''}`} onClick={onCopyFormat}>
      <Paintbrush size={16} /><span><strong>{painterActive ? 'Format painter active' : 'Copy photo format'}</strong><small>{painterActive ? 'Now click another photo to paste it' : 'Paste these settings with one click'}</small></span>
    </button>
  </div>;
}

function PhotoWorkspace() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('paperframe-settings')); } catch { return null; } })();
  const requestedOrientation = new URLSearchParams(window.location.search).get('orientation');
  const [settings, setSettings] = useState({
    ...defaultSettings, ...(saved || {}),
    ...(requestedOrientation === 'landscape' || requestedOrientation === 'portrait' ? { orientation: requestedOrientation } : {})
  });
  const [photos, setPhotos] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [paintFormat, setPaintFormat] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Loading project…');
  const [showPreflight, setShowPreflight] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(74);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightTab, setRightTab] = useState('layout');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef();
  const pageRef = useRef();
  const [pw, ph] = A4[settings.orientation];
  const usableWidth = pw - settings.marginLeft - settings.marginRight;
  const usableHeight = ph - settings.marginTop - settings.marginBottom;
  const effectiveCols = settings.fixedSize ? Math.max(1, Math.floor((usableWidth + settings.gapX) / (settings.photoWidth + settings.gapX))) : settings.cols;
  const effectiveRows = settings.fixedSize ? Math.max(1, Math.floor((usableHeight + settings.gapY) / (settings.photoHeight + settings.gapY))) : settings.rows;
  const perPage = effectiveCols * effectiveRows;
  const pages = Math.max(1, Math.ceil(photos.length / perPage));
  const pagePhotos = photos.slice(page * perPage, page * perPage + perPage);
  const selectedId = selectedIds[selectedIds.length - 1] || null;
  const selected = photos.find(p => p.id === selectedId);
  const preflightIssues = useMemo(() => {
    const issues = [];
    if (!photos.length) issues.push({ level: 'error', text: 'No photos have been added.' });
    const empty = pages * perPage - photos.length;
    if (photos.length && empty) issues.push({ level: 'warning', text: `${empty} empty grid cell${empty > 1 ? 's' : ''} on the final page.` });
    const lowResolution = photos.filter(photo => Math.min(photo.width, photo.height) < 900);
    if (lowResolution.length) issues.push({ level: 'warning', text: `${lowResolution.length} photo${lowResolution.length > 1 ? 's are' : ' is'} potentially low resolution for print.` });
    if ([settings.marginTop, settings.marginRight, settings.marginBottom, settings.marginLeft].some(value => value < 3)) {
      issues.push({ level: 'warning', text: 'Margins below 3 mm may exceed the printable area.' });
    }
    return issues;
  }, [photos, pages, perPage, settings]);

  useEffect(() => localStorage.setItem('paperframe-settings', JSON.stringify(settings)), [settings]);
  useEffect(() => {
    let active = true;
    loadAutosave().then(project => {
      if (!active) return;
      if (project?.settings) setSettings(project.settings);
      if (project?.photos?.length) {
        setPhotos(project.photos.map(photo => ({ ...photo, url: URL.createObjectURL(photo.file) })));
        setSaveStatus(`Recovered ${project.photos.length} photos`);
      } else setSaveStatus('Saved locally');
      setHydrated(true);
    }).catch(() => { if (active) { setHydrated(true); setSaveStatus('Local save unavailable'); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus('Saving…');
    const timer = setTimeout(() => {
      saveAutosave(settings, photos).then(() => setSaveStatus('Saved locally')).catch(() => setSaveStatus('Save failed'));
    }, 700);
    return () => clearTimeout(timer);
  }, [settings, photos, hydrated]);
  useEffect(() => {
    let style = document.getElementById('paperframe-print-page');
    if (!style) {
      style = document.createElement('style');
      style.id = 'paperframe-print-page';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: A4 ${settings.orientation}; margin: 0; }`;
    document.body.dataset.printOrientation = settings.orientation;
  }, [settings.orientation]);
  useEffect(() => {
    const onKeyDown = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [pages, page]);
  const flash = msg => { setToast(msg); window.setTimeout(() => setToast(''), 2400); };
  const snapshot = () => ({ settings: { ...settings }, photos: photos.map(p => ({ ...p })) });
  const checkpoint = () => {
    setUndoStack(stack => [...stack.slice(-49), snapshot()]);
    setRedoStack([]);
  };
  const changeSettings = updater => {
    checkpoint();
    setSettings(current => typeof updater === 'function' ? updater(current) : updater);
  };
  const undo = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(stack => [...stack, snapshot()]);
    setUndoStack(stack => stack.slice(0, -1));
    setSettings(previous.settings); setPhotos(previous.photos);
    setSelectedIds(ids => ids.filter(id => previous.photos.some(p => p.id === id)));
  };
  const redo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(stack => [...stack, snapshot()]);
    setRedoStack(stack => stack.slice(0, -1));
    setSettings(next.settings); setPhotos(next.photos);
    setSelectedIds(ids => ids.filter(id => next.photos.some(p => p.id === id)));
  };

  const addFiles = async files => {
    const accepted = [...files].filter(f => f.type.startsWith('image/'));
    const loaded = await Promise.all(accepted.map(file => new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({
        id: crypto.randomUUID(), file, url, name: file.name, width: img.naturalWidth, height: img.naturalHeight,
        fit: settings.fit, zoom: 1, x: 0, y: 0, expandX: 1, expandY: 1, mirrorX: false, mirrorY: false,
        rotation: 0, brightness: 100, contrast: 100, saturation: 100
      });
      img.src = url;
    })));
    if (loaded.length) checkpoint();
    setPhotos(old => [...old, ...loaded]);
    if (loaded.length) flash(`${loaded.length} photo${loaded.length > 1 ? 's' : ''} added`);
  };

  const updateSelected = patch => {
    checkpoint();
    setPhotos(ps => ps.map(p => selectedIds.includes(p.id) ? { ...p, ...patch } : p));
  };
  const removeSelected = () => {
    checkpoint();
    setPhotos(ps => ps.filter(p => !selectedIds.includes(p.id)));
    setSelectedIds([]);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    checkpoint();
    setPhotos(ps => [...ps, { ...selected, id: crypto.randomUUID(), name: `${selected.name} copy` }]);
    flash('Photo duplicated');
  };
  const movePhoto = (id, targetGlobalIndex) => {
    const from = photos.findIndex(p => p.id === id);
    if (from < 0) return;
    const next = [...photos], [item] = next.splice(from, 1);
    next.splice(Math.min(targetGlobalIndex, next.length), 0, item);
    checkpoint(); setPhotos(next);
  };
  const formatKeys = ['fit', 'zoom', 'x', 'y', 'expandX', 'expandY', 'mirrorX', 'mirrorY', 'rotation', 'brightness', 'contrast', 'saturation'];
  const selectPhoto = (id, event = {}) => {
    if (!id) { if (!event.ctrlKey && !event.metaKey) setSelectedIds([]); return; }
    if (paintFormat) {
      checkpoint();
      setPhotos(ps => ps.map(p => p.id === id ? { ...p, ...paintFormat } : p));
      setSelectedIds([id]); setPaintFormat(null); setRightTab('photo'); flash('Photo format applied');
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
    } else setSelectedIds([id]);
    setRightTab('photo');
  };
  const copyFormat = () => {
    if (!selected) return;
    setPaintFormat(Object.fromEntries(formatKeys.map(key => [key, selected[key]])));
    flash('Format copied — click a photo to apply');
  };

  const imageData = photo => new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const c = canvas.getContext('2d');
      c.filter = `brightness(${photo.brightness}%) contrast(${photo.contrast}%) saturate(${photo.saturation}%)`;
      c.save();
      c.translate(photo.mirrorX ? canvas.width : 0, photo.mirrorY ? canvas.height : 0);
      c.scale(photo.mirrorX ? -1 : 1, photo.mirrorY ? -1 : 1);
      c.drawImage(img, 0, 0);
      c.restore();
      resolve(canvas.toDataURL('image/jpeg', .93));
    };
    img.src = photo.url;
  });

  const exportPdf = async () => {
    if (!photos.length) return flash('Add at least one photo first');
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: settings.orientation, unit: 'mm', format: 'a4', compress: true });
      const cellW = settings.fixedSize ? settings.photoWidth : (pw - settings.marginLeft - settings.marginRight - settings.gapX * (effectiveCols - 1)) / effectiveCols;
      const cellH = settings.fixedSize ? settings.photoHeight : (ph - settings.marginTop - settings.marginBottom - settings.gapY * (effectiveRows - 1)) / effectiveRows;
      const data = await Promise.all(photos.map(imageData));
      for (let pg = 0; pg < pages; pg++) {
        if (pg) doc.addPage('a4', settings.orientation);
        for (let i = 0; i < perPage; i++) {
          const idx = pg * perPage + i, photo = photos[idx];
          const col = i % effectiveCols, row = Math.floor(i / effectiveCols);
          const x = settings.marginLeft + col * (cellW + settings.gapX);
          const y = settings.marginTop + row * (cellH + settings.gapY);
          doc.setFillColor(settings.background); doc.rect(x, y, cellW, cellH, 'F');
          if (photo) {
            const ratio = photo.width / photo.height, cellRatio = cellW / cellH;
            let w, h;
            if ((photo.fit === 'contain' && ratio > cellRatio) || (photo.fit === 'cover' && ratio < cellRatio)) {
              w = cellW * photo.zoom; h = w / ratio;
            } else { h = cellH * photo.zoom; w = h * ratio; }
            w *= photo.expandX || 1; h *= photo.expandY || 1;
            const ix = x + (cellW - w) / 2 + (photo.x / 100) * cellW;
            const iy = y + (cellH - h) / 2 + (photo.y / 100) * cellH;
            doc.saveGraphicsState();
            doc.rect(x, y, cellW, cellH, null);
            doc.clip(); doc.discardPath();
            doc.addImage(data[idx], 'JPEG', ix, iy, w, h, undefined, 'FAST', photo.rotation);
            doc.restoreGraphicsState();
          }
          if (settings.border) {
            doc.setLineWidth(settings.borderWidth); doc.setDrawColor(35, 36, 34); doc.rect(x, y, cellW, cellH);
          }
        }
      }
      doc.save('paperframe-a4-layout.pdf');
      flash('Print-ready PDF downloaded');
    } catch (e) { console.error(e); flash('Could not create PDF'); }
    setExporting(false);
  };

  return <div className="workspace">
    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} />
    <aside className={`asset-panel ${leftOpen ? '' : 'collapsed'}`}>
      <div className="panel-heading"><div><small>ASSETS</small><strong>Photos <span>{photos.length}</span></strong></div>
        <IconButton label="Collapse photos" onClick={() => setLeftOpen(false)}><PanelLeftClose size={17} /></IconButton></div>
      <button className="upload-zone" onClick={() => fileRef.current.click()}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
        <Upload size={18} /><span><strong>Add photos</strong><small>Drop images or browse</small></span>
      </button>
      <div className="asset-list">
        {photos.map((p, i) => <button key={p.id} draggable onDragStart={e => e.dataTransfer.setData('photoId', p.id)}
          className={`asset ${selectedIds.includes(p.id) ? 'selected' : ''}`} onClick={e => { selectPhoto(p.id, e); setPage(Math.floor(i / perPage)); }}>
          <img src={p.url} alt="" /><span><strong>{p.name}</strong><small>Page {Math.floor(i / perPage) + 1} · Cell {(i % perPage) + 1}</small></span><MoreHorizontal size={15} />
        </button>)}
        {!photos.length && <div className="asset-empty"><Layers3 size={24} /><p>Your uploaded photos will appear here.</p></div>}
      </div>
      {photos.length > 0 && <button className="text-button danger-text" onClick={() => { checkpoint(); setPhotos([]); setSelectedIds([]); clearAutosave(); }}><Trash2 size={14} /> Clear all photos</button>}
    </aside>
    {!leftOpen && <IconButton label="Open photos" className="floating-left" onClick={() => setLeftOpen(true)}><ImageIcon size={17} /></IconButton>}

    <main className="canvas-area">
      <div className="canvas-toolbar">
        <div className="crumb"><span>Untitled project</span><small>{saveStatus}</small></div>
        <div className="history">
          <IconButton label="Undo" disabled={!undoStack.length} onClick={undo}><Undo2 size={17} /></IconButton>
          <IconButton label="Redo" disabled={!redoStack.length} onClick={redo}><Redo2 size={17} /></IconButton>
          <span className="vline" />
          <button className="page-picker">Page {page + 1} of {pages}<ChevronDown size={14} /></button>
        </div>
        <div className="top-actions">
          <button className={`preflight-button ${preflightIssues.some(issue => issue.level === 'error') ? 'has-error' : preflightIssues.length ? 'has-warning' : 'ready'}`} onClick={() => setShowPreflight(value => !value)}>
            {preflightIssues.length ? preflightIssues.length : <Check size={13} />} Preflight
          </button>
          <button className="secondary" onClick={() => window.print()}><Printer size={16} /> Print {settings.orientation === 'portrait' ? 'portrait' : 'landscape'}</button>
          <button className="primary" onClick={exportPdf} disabled={exporting}>
            {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Export PDF</button>
        </div>
      </div>
      {showPreflight && <div className="preflight-popover">
        <div className="preflight-heading"><div><strong>Print preflight</strong><small>{preflightIssues.length ? `${preflightIssues.length} item${preflightIssues.length > 1 ? 's' : ''} to review` : 'Ready to print'}</small></div><IconButton label="Close preflight" onClick={() => setShowPreflight(false)}><X size={15} /></IconButton></div>
        {!preflightIssues.length ? <div className="preflight-ready"><Check size={18} /><span><strong>Everything looks good</strong><small>{photos.length} photos · {pages} A4 page{pages > 1 ? 's' : ''}</small></span></div>
          : preflightIssues.map((issue, index) => <div className={`preflight-item ${issue.level}`} key={index}><span>!</span><p>{issue.text}</p></div>)}
      </div>}
      <div className="canvas-scroll" onDragOver={e => e.preventDefault()} onDrop={e => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        <div className={`page-stage ${settings.orientation}`} style={{
          '--zoom': zoom / 100,
          width: `${Math.round((settings.orientation === 'landscape' ? 650 : 505) * zoom / 74)}px`
        }}>
          <div className={`a4-page ${settings.orientation}`} ref={pageRef} style={{
            aspectRatio: `${pw}/${ph}`, padding: `${settings.marginTop / ph * 100}% ${settings.marginRight / pw * 100}% ${settings.marginBottom / ph * 100}% ${settings.marginLeft / pw * 100}%`,
            background: settings.background
          }}>
            <div className="grid" style={{
              gridTemplateColumns: settings.fixedSize ? `repeat(${effectiveCols}, ${settings.photoWidth / usableWidth * 100}%)` : `repeat(${effectiveCols}, 1fr)`,
              gridTemplateRows: settings.fixedSize ? `repeat(${effectiveRows}, ${settings.photoHeight / usableHeight * 100}%)` : `repeat(${effectiveRows}, 1fr)`,
              columnGap: `${settings.gapX / pw * 100}%`, rowGap: `${settings.gapY / ph * 100}%`
            }}>
              {Array.from({ length: perPage }).map((_, i) => <PhotoCell key={i} photo={pagePhotos[i]} index={i}
                settings={settings} selected={selectedIds.includes(pagePhotos[i]?.id)}
                painterActive={Boolean(paintFormat && pagePhotos[i])}
                onSelect={selectPhoto}
                onDropPhoto={(id, idx) => movePhoto(id, page * perPage + idx)} />)}
            </div>
            {!photos.length && <EmptyCanvas onUpload={() => fileRef.current.click()} />}
          </div>
          <div className="page-label">A4 · {settings.orientation === 'portrait' ? '210 × 297' : '297 × 210'} mm</div>
        </div>
      </div>
      <div className="zoom-bar">
        <IconButton label="Zoom out" onClick={() => setZoom(z => Math.max(40, z - 10))}><Minus size={15} /></IconButton>
        <input type="range" min="40" max="110" value={zoom} onChange={e => setZoom(Number(e.target.value))} />
        <IconButton label="Zoom in" onClick={() => setZoom(z => Math.min(110, z + 10))}><Plus size={15} /></IconButton>
        <button onClick={() => setZoom(74)}>{zoom}%</button>
      </div>
      {pages > 1 && <div className="page-nav">
        <IconButton label="Previous page" disabled={!page} onClick={() => setPage(p => p - 1)}><ArrowLeft size={16} /></IconButton>
        {Array.from({ length: pages }).map((_, i) => <button key={i} className={page === i ? 'current' : ''} onClick={() => setPage(i)}>{i + 1}</button>)}
        <IconButton label="Next page" disabled={page === pages - 1} onClick={() => setPage(p => p + 1)}><ArrowRight size={16} /></IconButton>
      </div>}
    </main>

    <aside className="settings-panel">
      <div className="settings-tabs">
        <button className={rightTab === 'layout' ? 'selected' : ''} onClick={() => setRightTab('layout')}><Grid2X2 size={16} /> Layout</button>
        <button className={rightTab === 'photo' ? 'selected' : ''} onClick={() => setRightTab('photo')}><Crop size={16} /> Photo</button>
      </div>
      {rightTab === 'layout' ? <div className="settings-content">
        <section><div className="section-title"><strong>Page setup</strong><span className="status-dot"><Check size={11} /> A4 fixed</span></div>
          <div className="control-label">Orientation</div>
          <Segmented value={settings.orientation} onChange={orientation => changeSettings(s => ({ ...s, orientation }))} options={[
            { value: 'portrait', label: 'Portrait', icon: <span className="paper-icon portrait" /> },
            { value: 'landscape', label: 'Landscape', icon: <span className="paper-icon landscape" /> }
          ]} />
        </section>
        <section><div className="section-title"><strong>Grid layout</strong><span>{effectiveCols} columns × {effectiveRows} rows</span></div>
          <div className="layout-presets">
            {layouts.map(l => <button title={`${l.cols} columns × ${l.rows} rows`} key={`${l.cols}x${l.rows}`}
              className={settings.cols === l.cols && settings.rows === l.rows ? 'selected' : ''}
              onClick={() => changeSettings(s => ({ ...s, ...l, fixedSize: false }))}>
              <span className="mini-grid" style={{ gridTemplateColumns: `repeat(${l.cols},1fr)`, gridTemplateRows: `repeat(${l.rows},1fr)` }}>
                {Array.from({ length: l.cols * l.rows }).map((_, i) => <i key={i} />)}
              </span><small>{l.cols} × {l.rows}</small>
            </button>)}
          </div>
          <div className="two-col">
            <NumberInput label="Columns" value={settings.cols} min={1} max={6} suffix="" onChange={cols => changeSettings(s => ({ ...s, cols, fixedSize: false }))} />
            <NumberInput label="Rows" value={settings.rows} min={1} max={8} suffix="" onChange={rows => changeSettings(s => ({ ...s, rows, fixedSize: false }))} />
          </div>
        </section>
        <section><div className="section-title"><strong>Exact photo size</strong><span>{settings.fixedSize ? `${settings.photoWidth} × ${settings.photoHeight} mm` : 'Off'}</span></div>
          <label className="toggle-row exact-toggle"><span><strong>Physical-size mode</strong><small>Preserved at 100% print scale</small></span>
            <input type="checkbox" checked={settings.fixedSize} onChange={e => changeSettings(s => ({ ...s, fixedSize: e.target.checked }))} /><i /></label>
          {settings.fixedSize && <><div className="two-col exact-inputs">
            <NumberInput label="Photo width" value={settings.photoWidth} min={10} max={150} step={1} onChange={photoWidth => changeSettings(s => ({ ...s, photoWidth }))} />
            <NumberInput label="Photo height" value={settings.photoHeight} min={10} max={200} step={1} onChange={photoHeight => changeSettings(s => ({ ...s, photoHeight }))} />
          </div><div className="exact-capacity"><Check size={13} /> Fits {effectiveCols * effectiveRows} photos per A4 page</div></>}
          <div className="size-presets">
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: true, photoWidth: 35, photoHeight: 45, gapX: 2, gapY: 2 }))}><strong>35 × 45</strong><small>Passport</small></button>
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: true, photoWidth: 51, photoHeight: 51, gapX: 2, gapY: 2 }))}><strong>51 × 51</strong><small>Square visa</small></button>
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: true, photoWidth: 85.6, photoHeight: 54, gapX: 3, gapY: 3 }))}><strong>85.6 × 54</strong><small>ID card</small></button>
          </div>
        </section>
        <section><div className="section-title"><strong>Quick templates</strong><span>One click</span></div>
          <div className="quick-templates">
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: false, orientation: 'portrait', cols: 1, rows: 1, gapX: 0, gapY: 0, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }))}><span>01</span><strong>Full page</strong><small>Single image</small></button>
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: false, orientation: 'portrait', cols: 2, rows: 2, gapX: 2, gapY: 2, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }))}><span>04</span><strong>Classic four</strong><small>Balanced grid</small></button>
            <button onClick={() => changeSettings(s => ({ ...s, fixedSize: false, orientation: 'portrait', cols: 3, rows: 3, gapX: 2, gapY: 2, marginTop: 8, marginRight: 8, marginBottom: 8, marginLeft: 8 }))}><span>09</span><strong>Contact sheet</strong><small>Nine photos</small></button>
          </div>
        </section>
        <section><div className="section-title"><strong>Margins</strong><button className="link-button" onClick={() => changeSettings(s => ({ ...s, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }))}>Reset</button></div>
          <div className="margin-diagram">
            <span className="margin-top">{settings.marginTop}</span><span className="margin-right">{settings.marginRight}</span>
            <span className="margin-bottom">{settings.marginBottom}</span><span className="margin-left">{settings.marginLeft}</span>
            <div><Grid2X2 size={18} /></div>
          </div>
          <div className="two-col margin-inputs">
            <NumberInput label="Top" value={settings.marginTop} onChange={marginTop => changeSettings(s => ({ ...s, marginTop }))} />
            <NumberInput label="Right" value={settings.marginRight} onChange={marginRight => changeSettings(s => ({ ...s, marginRight }))} />
            <NumberInput label="Bottom" value={settings.marginBottom} onChange={marginBottom => changeSettings(s => ({ ...s, marginBottom }))} />
            <NumberInput label="Left" value={settings.marginLeft} onChange={marginLeft => changeSettings(s => ({ ...s, marginLeft }))} />
          </div>
        </section>
        <section><div className="section-title"><strong>Spacing & border</strong></div>
          <div className="two-col">
            <NumberInput label="Column gap" value={settings.gapX} max={20} onChange={gapX => changeSettings(s => ({ ...s, gapX }))} />
            <NumberInput label="Row gap" value={settings.gapY} max={20} onChange={gapY => changeSettings(s => ({ ...s, gapY }))} />
          </div>
          <label className="toggle-row"><span><strong>Cell borders</strong><small>Show on export</small></span>
            <input type="checkbox" checked={settings.border} onChange={e => changeSettings(s => ({ ...s, border: e.target.checked }))} /><i /></label>
        </section>
        <div className="print-note"><Printer size={17} /><div><strong>Print at actual size</strong><p>Choose “Actual size” or “100%” in your printer dialog for precise dimensions.</p></div></div>
      </div> : <div className="settings-content"><PhotoEditorPanel photo={selected} selectedCount={selectedIds.length} onUpdate={updateSelected} onDelete={removeSelected} onDuplicate={duplicateSelected} onCopyFormat={copyFormat} painterActive={Boolean(paintFormat)} /></div>}
    </aside>
    <Toast message={toast} />
  </div>;
}

function MergePdfLegacy() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const input = useRef();
  const flash = m => { setToast(m); setTimeout(() => setToast(''), 2200); };
  const add = async incoming => {
    const pdfs = [...incoming].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const added = [];
    for (const file of pdfs) {
      try {
        const bytes = await file.arrayBuffer(); const doc = await PDFDocument.load(bytes);
        added.push({ id: crypto.randomUUID(), file, bytes, name: file.name, pages: doc.getPageCount(), rotation: 0 });
      } catch { flash(`Could not read ${file.name}`); }
    }
    setFiles(x => [...x, ...added]); if (added.length) flash(`${added.length} PDF${added.length > 1 ? 's' : ''} added`);
  };
  const move = (i, d) => setFiles(f => { const n = [...f], j = i + d; if (j < 0 || j >= n.length) return f; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const exportMerged = async () => {
    if (!files.length) return; setBusy(true);
    try {
      const out = await PDFDocument.create();
      for (const item of files) {
        const src = await PDFDocument.load(item.bytes);
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(p => { if (item.rotation) p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360)); out.addPage(p); });
      }
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'paperframe-merged.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); flash('PDF downloaded');
    } catch (e) { console.error(e); flash('Could not export PDF'); }
    setBusy(false);
  };
  return <div className="pdf-workspace">
    <input ref={input} type="file" accept=".pdf,application/pdf" multiple hidden onChange={e => add(e.target.files)} />
    <div className="pdf-hero">
      <div><span className="eyebrow"><Sparkles size={13} /> PDF PAGE TOOLS</span><h1>Organize PDFs without the clutter.</h1>
        <p>Merge, reorder, rotate, or remove PDF files. Everything happens locally in your browser.</p></div>
      <button className="primary large" onClick={() => input.current.click()}><FilePlus2 size={18} /> Add PDF files</button>
    </div>
    <div className="pdf-body">
      <div className="pdf-list-heading"><div><strong>Your documents</strong><span>{files.reduce((a, f) => a + f.pages, 0)} pages in {files.length} files</span></div>
        {files.length > 0 && <button className="text-button danger-text" onClick={() => setFiles([])}><Trash2 size={14} /> Clear list</button>}</div>
      {!files.length ? <button className="pdf-drop" onClick={() => input.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        <div><Upload size={25} /></div><strong>Drop your PDFs here</strong><span>or click to browse · multiple files supported</span>
      </button> : <div className="pdf-files">
        {files.map((f, i) => <div className="pdf-file" key={f.id}>
          <div className="drag-handle"><MoreHorizontal size={18} /></div><div className="pdf-thumb"><FileText size={28} /><span>{f.pages}</span></div>
          <div className="pdf-info"><strong>{f.name}</strong><span>{f.pages} page{f.pages !== 1 ? 's' : ''}{f.rotation ? ` · rotated ${f.rotation}°` : ''}</span></div>
          <div className="pdf-actions">
            <IconButton label="Move up" disabled={!i} onClick={() => move(i, -1)}><ArrowUp size={16} /></IconButton>
            <IconButton label="Move down" disabled={i === files.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></IconButton>
            <IconButton label="Rotate" onClick={() => setFiles(x => x.map(v => v.id === f.id ? { ...v, rotation: (v.rotation + 90) % 360 } : v))}><RotateCw size={16} /></IconButton>
            <IconButton label="Remove" className="danger" onClick={() => setFiles(x => x.filter(v => v.id !== f.id))}><Trash2 size={16} /></IconButton>
          </div>
        </div>)}
        <button className="add-another" onClick={() => input.current.click()}><Plus size={16} /> Add another PDF</button>
      </div>}
      <aside className="pdf-summary">
        <span className="eyebrow">OUTPUT SUMMARY</span><h3>{files.length ? `${files.reduce((a, f) => a + f.pages, 0)} pages` : 'No files yet'}</h3>
        <p>{files.length ? `${files.length} document${files.length > 1 ? 's' : ''} will be combined in the order shown.` : 'Add PDFs to prepare a combined document.'}</p>
        <button className="primary full" disabled={!files.length || busy} onClick={exportMerged}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Download merged PDF</button>
        <small><Check size={12} /> Files never leave your device</small>
      </aside>
    </div><Toast message={toast} />
  </div>;
}

const prettyBytes = size => size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
const savePdf = (bytes, name) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
};
const loadPdfItem = async file => {
  const originalBytes = await file.arrayBuffer();
  try {
    const document = await PDFDocument.load(originalBytes);
    return { file, bytes: originalBytes, name: file.name, pages: document.getPageCount(), size: file.size, id: crypto.randomUUID(), rotation: 0, repaired: false };
  } catch (originalError) {
    const source = new Uint8Array(originalBytes);
    let jpegStart = -1, jpegEnd = -1;
    for (let index = 0; index < source.length - 1; index++) {
      if (jpegStart < 0 && source[index] === 0xff && source[index + 1] === 0xd8) jpegStart = index;
      if (source[index] === 0xff && source[index + 1] === 0xd9) jpegEnd = index + 2;
    }
    const header = new TextDecoder('latin1').decode(source.slice(0, Math.min(512, source.length)));
    const recoverable = header.startsWith('%PDF-') && header.includes('/Subtype/Image') &&
      header.includes('/Filter/DCTDecode') && jpegStart >= 0 && jpegEnd > jpegStart;
    if (!recoverable) throw originalError;

    const repaired = await PDFDocument.create();
    const image = await repaired.embedJpg(source.slice(jpegStart, jpegEnd));
    const maxWidth = 595.28, maxHeight = 841.89;
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    const page = repaired.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    const repairedBytes = await repaired.save({ useObjectStreams: true });
    return { file, bytes: repairedBytes, name: file.name, pages: 1, size: file.size, id: crypto.randomUUID(), rotation: 0, repaired: true };
  }
};

function ToolDrop({ onFiles, multiple, title }) {
  const ref = useRef();
  return <><input ref={ref} hidden type="file" multiple={multiple} accept=".pdf,application/pdf" onChange={e => onFiles(e.target.files)} />
    <button className="pdf-drop tool-drop" onClick={() => ref.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
      <div><Upload size={25} /></div><strong>{title}</strong><span>Drop PDF here or click to browse</span>
    </button></>;
}

function MergeTool({ notify }) {
  const [items, setItems] = useState([]), [busy, setBusy] = useState(false);
  const add = async files => {
    const added = [];
    for (const file of [...files]) try { added.push(await loadPdfItem(file)); } catch { notify(`Could not read ${file.name}`); }
    setItems(current => [...current, ...added]);
    if (added.some(item => item.repaired)) notify('Incomplete image-only PDF repaired automatically');
  };
  const move = (index, delta) => setItems(current => {
    const next = [...current], target = index + delta; if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  const merge = async () => {
    setBusy(true);
    try {
      const out = await PDFDocument.create();
      for (const item of items) {
        const source = await PDFDocument.load(item.bytes), pages = await out.copyPages(source, source.getPageIndices());
        pages.forEach(page => { if (item.rotation) page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360)); out.addPage(page); });
      }
      savePdf(await out.save({ useObjectStreams: true }), 'paperframe-merged.pdf'); notify('Merged PDF downloaded');
    } catch { notify('Could not merge these PDFs'); }
    setBusy(false);
  };
  if (!items.length) return <ToolDrop multiple title="Drop PDFs to merge" onFiles={add} />;
  return <div className="tool-workarea"><div className="tool-summary-line"><strong>{items.length} PDFs · {items.reduce((n, x) => n + x.pages, 0)} pages</strong><span>{prettyBytes(items.reduce((n, x) => n + x.size, 0))} total</span></div>
    <div className="pdf-files">{items.map((item, index) => <div className="pdf-file" key={item.id}><div className="pdf-thumb"><FileText size={27} /><span>{item.pages}</span></div>
      <div className="pdf-info"><strong>{item.name}</strong><span>{item.pages} pages · {prettyBytes(item.size)}{item.repaired ? ' · repaired' : ''}{item.rotation ? ` · ${item.rotation}°` : ''}</span></div>
      <div className="pdf-actions"><IconButton label="Move up" disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={15} /></IconButton><IconButton label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></IconButton>
        <IconButton label="Rotate" onClick={() => setItems(all => all.map(x => x.id === item.id ? { ...x, rotation: (x.rotation + 90) % 360 } : x))}><RotateCw size={15} /></IconButton><IconButton label="Remove" onClick={() => setItems(all => all.filter(x => x.id !== item.id))}><Trash2 size={15} /></IconButton></div></div>)}</div>
    <ToolDrop multiple title="Add more PDFs" onFiles={add} /><button className="primary tool-main-action" disabled={busy} onClick={merge}>{busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Download merged PDF</button></div>;
}

function SplitTool({ notify }) {
  const [item, setItem] = useState(null), [range, setRange] = useState('1'), [busy, setBusy] = useState(false);
  const add = async files => { try { const loaded = await loadPdfItem(files[0]); setItem(loaded); setRange(`1-${loaded.pages}`); if (loaded.repaired) notify('Incomplete image-only PDF repaired automatically'); } catch { notify('Could not read this PDF'); } };
  const getPages = () => {
    const found = new Set();
    range.split(',').forEach(part => {
      const token = part.trim(); if (!token) return;
      if (token.includes('-')) { const [a, b] = token.split('-').map(Number); if (!a || !b || a > b) throw Error('Invalid range'); for (let p = a; p <= b; p++) found.add(p); }
      else { const p = Number(token); if (!p) throw Error('Invalid page'); found.add(p); }
    });
    const pages = [...found]; if (!pages.length || pages.some(p => p < 1 || p > item.pages)) throw Error(`Use pages from 1 to ${item.pages}`); return pages;
  };
  const split = async separate => {
    setBusy(true);
    try {
      const chosen = getPages(), source = await PDFDocument.load(item.bytes);
      if (separate) for (const number of chosen) {
        const out = await PDFDocument.create(), [page] = await out.copyPages(source, [number - 1]); out.addPage(page);
        savePdf(await out.save({ useObjectStreams: true }), `${item.name.replace(/\.pdf$/i, '')}-page-${number}.pdf`);
      } else {
        const out = await PDFDocument.create(), pages = await out.copyPages(source, chosen.map(p => p - 1)); pages.forEach(p => out.addPage(p));
        savePdf(await out.save({ useObjectStreams: true }), `${item.name.replace(/\.pdf$/i, '')}-extracted.pdf`);
      }
      notify(separate ? 'Individual page PDFs created' : 'Selected pages extracted');
    } catch (error) { notify(error.message); } setBusy(false);
  };
  if (!item) return <ToolDrop title="Drop one PDF to split" onFiles={add} />;
  return <div className="tool-workarea"><DocumentBar item={item} icon={<Scissors size={24} />} onReplace={() => setItem(null)} />
    <label className="pdf-tool-field"><span>Pages or ranges</span><input value={range} onChange={e => setRange(e.target.value)} placeholder="1-3, 5, 8-10" /><small>Example: 1-3, 5, 8-10</small></label>
    <div className="tool-button-row"><button className="primary" disabled={busy} onClick={() => split(false)}><Download size={16} /> Extract as one PDF</button><button className="secondary" disabled={busy} onClick={() => split(true)}><Scissors size={16} /> One PDF per page</button></div></div>;
}

function DocumentBar({ item, icon, onReplace }) {
  return <div className="loaded-document"><div className="pdf-thumb">{icon}<span>{item.pages}</span></div><div><strong>{item.name}</strong><small>{item.pages} pages · {prettyBytes(item.size)}{item.repaired ? ' · automatically repaired' : ''}</small></div><button className="secondary" onClick={onReplace}>Replace</button></div>;
}

function CompressTool({ notify }) {
  const [item, setItem] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  const add = async files => { try { const loaded = await loadPdfItem(files[0]); setItem(loaded); setResult(null); if (loaded.repaired) notify('Incomplete image-only PDF repaired automatically'); } catch { notify('Could not read this PDF'); } };
  const optimize = async () => {
    setBusy(true);
    try {
      const source = await PDFDocument.load(item.bytes), out = await PDFDocument.create(), pages = await out.copyPages(source, source.getPageIndices());
      pages.forEach(page => out.addPage(page)); out.setProducer('Paperframe Studio');
      const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 100 });
      setResult(bytes); notify(bytes.length < item.size ? 'PDF optimized' : 'PDF is already well optimized');
    } catch { notify('Could not optimize PDF'); } setBusy(false);
  };
  if (!item) return <ToolDrop title="Drop one PDF to compress" onFiles={add} />;
  return <div className="tool-workarea"><DocumentBar item={item} icon={<Maximize2 size={24} />} onReplace={() => { setItem(null); setResult(null); }} />
    <div className="compression-meter"><div><small>BEFORE</small><strong>{prettyBytes(item.size)}</strong></div><ArrowRight size={21} /><div><small>AFTER</small><strong>{result ? prettyBytes(result.length) : '—'}</strong></div></div>
    <div className="compression-note"><Sparkles size={18} /><div><strong>Quality-safe optimization</strong><p>Rebuilds PDF object streams and removes unused structure without making images blurry.</p></div></div>
    {!result ? <button className="primary tool-main-action" disabled={busy} onClick={optimize}>{busy ? <LoaderCircle className="spin" size={16} /> : <Maximize2 size={16} />} Optimize PDF</button>
      : <button className="primary tool-main-action" onClick={() => savePdf(result, `${item.name.replace(/\.pdf$/i, '')}-compressed.pdf`)}><Download size={16} /> Download optimized PDF</button>}</div>;
}

function PdfPageThumbnail({ bytes, pageIndex, rotation }) {
  const ref = useRef();
  useEffect(() => {
    let cancelled = false, loading;
    (async () => {
      try {
        const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
        loading = pdfjsLib.getDocument({ data });
        const pdf = await loading.promise, page = await pdf.getPage(pageIndex + 1);
        const base = page.getViewport({ scale: 1, rotation }), scale = Math.min(110 / base.width, 135 / base.height);
        const viewport = page.getViewport({ scale, rotation }), canvas = ref.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch { /* Thumbnail remains as a page placeholder. */ }
    })();
    return () => { cancelled = true; loading?.destroy(); };
  }, [bytes, pageIndex, rotation]);
  return <canvas ref={ref} />;
}

function OrganizeTool({ notify }) {
  const [item, setItem] = useState(null), [pages, setPages] = useState([]), [busy, setBusy] = useState(false);
  const add = async files => {
    try {
      const loaded = await loadPdfItem(files[0]); setItem(loaded);
      setPages(Array.from({ length: loaded.pages }, (_, index) => ({ id: crypto.randomUUID(), sourceIndex: index, rotation: 0 })));
      if (loaded.repaired) notify('Incomplete image-only PDF repaired automatically');
    } catch { notify('Could not read this PDF'); }
  };
  const move = (index, delta) => setPages(current => {
    const target = index + delta; if (target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  const exportOrganized = async () => {
    if (!pages.length) return notify('Keep at least one page');
    setBusy(true);
    try {
      const source = await PDFDocument.load(item.bytes), out = await PDFDocument.create();
      for (const record of pages) {
        const [copied] = await out.copyPages(source, [record.sourceIndex]);
        copied.setRotation(degrees((copied.getRotation().angle + record.rotation) % 360)); out.addPage(copied);
      }
      savePdf(await out.save({ useObjectStreams: true }), `${item.name.replace(/\.pdf$/i, '')}-organized.pdf`);
      notify('Organized PDF downloaded');
    } catch { notify('Could not organize this PDF'); }
    setBusy(false);
  };
  if (!item) return <ToolDrop title="Drop one PDF to organize" onFiles={add} />;
  return <div className="tool-workarea organizer-workarea"><DocumentBar item={item} icon={<Grid2X2 size={24} />} onReplace={() => { setItem(null); setPages([]); }} />
    <div className="organizer-summary"><span>{pages.length} output pages</span><small>Reorder, rotate, duplicate, or delete</small></div>
    <div className="page-organizer-grid">{pages.map((record, index) => <div className="organizer-page" key={record.id}>
      <div className="organizer-preview"><PdfPageThumbnail bytes={item.bytes} pageIndex={record.sourceIndex} rotation={record.rotation} /><span>{index + 1}</span></div>
      <strong>Page {record.sourceIndex + 1}{record.rotation ? ` · ${record.rotation}°` : ''}</strong>
      <div className="organizer-actions"><IconButton label="Move left" disabled={!index} onClick={() => move(index, -1)}><ArrowLeft size={14} /></IconButton>
        <IconButton label="Move right" disabled={index === pages.length - 1} onClick={() => move(index, 1)}><ArrowRight size={14} /></IconButton>
        <IconButton label="Rotate page" onClick={() => setPages(current => current.map(page => page.id === record.id ? { ...page, rotation: (page.rotation + 90) % 360 } : page))}><RotateCw size={14} /></IconButton>
        <IconButton label="Duplicate page" onClick={() => setPages(current => { const next = [...current]; next.splice(index + 1, 0, { ...record, id: crypto.randomUUID() }); return next; })}><Copy size={14} /></IconButton>
        <IconButton label="Delete page" onClick={() => setPages(current => current.filter(page => page.id !== record.id))}><Trash2 size={14} /></IconButton></div>
    </div>)}</div>
    <button className="primary tool-main-action" disabled={busy || !pages.length} onClick={exportOrganized}>{busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Download organized PDF</button>
  </div>;
}

function AnnotateTool({ notify }) {
  const [item, setItem] = useState(null), [pageNo, setPageNo] = useState(1), [mode, setMode] = useState('pen');
  const [marks, setMarks] = useState([]), [drawing, setDrawing] = useState(null), [color, setColor] = useState('#d8673f');
  const [lineWidth, setLineWidth] = useState(3), [busy, setBusy] = useState(false), [signature, setSignature] = useState(null);
  const canvasRef = useRef(), surfaceRef = useRef(), scaleRef = useRef({ x: 1, y: 1 });
  const add = async files => { try { setItem(await loadPdfItem(files[0])); setMarks([]); } catch { notify('Could not read this PDF'); } };
  useEffect(() => {
    if (!item) return;
    let cancelled = false, loading;
    (async () => {
      try {
        const data = item.bytes instanceof Uint8Array ? item.bytes.slice() : new Uint8Array(item.bytes.slice(0));
        loading = pdfjsLib.getDocument({ data }); const pdf = await loading.promise, page = await pdf.getPage(pageNo);
        const base = page.getViewport({ scale: 1 }), scale = Math.min(760 / base.width, 850 / base.height, 1.35), viewport = page.getViewport({ scale });
        const canvas = canvasRef.current; if (!canvas || cancelled) return;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        scaleRef.current = { x: base.width / viewport.width, y: base.height / viewport.height, pageWidth: base.width, pageHeight: base.height };
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch { if (!cancelled) notify('Could not render this page'); }
    })();
    return () => { cancelled = true; loading?.destroy(); };
  }, [item, pageNo]);
  const point = event => {
    const box = surfaceRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const startMark = event => {
    if (!['pen', 'highlight', 'redact'].includes(mode)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event); setDrawing({ id: crypto.randomUUID(), page: pageNo, type: mode, color, width: lineWidth, points: [start], sx: scaleRef.current.x, sy: scaleRef.current.y });
  };
  const continueMark = event => {
    if (!drawing) return;
    const next = point(event);
    setDrawing(current => current ? { ...current, points: [...current.points, next] } : null);
  };
  const finishMark = () => {
    if (!drawing) return;
    setMarks(current => [...current, drawing]); setDrawing(null);
  };
  const addStamp = label => setMarks(current => [...current, { id: crypto.randomUUID(), page: pageNo, type: 'stamp', text: label, x: 80, y: 90, color, sx: scaleRef.current.x, sy: scaleRef.current.y }]);
  const exportAnnotated = async () => {
    setBusy(true);
    try {
      const doc = await PDFDocument.load(item.bytes), pages = doc.getPages();
      for (const mark of marks) {
        const page = pages[mark.page - 1], { height } = page.getSize(), sx = mark.sx || 1, sy = mark.sy || 1;
        if (mark.type === 'stamp') {
          const font = await doc.embedFont(StandardFonts.HelveticaBold);
          page.drawText(mark.text, { x: mark.x * sx, y: height - mark.y * sy, size: 22, font, color: rgb(0.78, 0.16, 0.12), opacity: .85 });
        } else if (mark.type === 'redact') {
          const first = mark.points[0], last = mark.points[mark.points.length - 1];
          page.drawRectangle({ x: Math.min(first.x, last.x) * sx, y: height - Math.max(first.y, last.y) * sy, width: Math.abs(last.x - first.x) * sx, height: Math.abs(last.y - first.y) * sy, color: rgb(0, 0, 0) });
        } else {
          const [r, g, b] = [1, 3, 5].map(index => parseInt(mark.color.slice(index, index + 2), 16) / 255);
          for (let index = 1; index < mark.points.length; index++) {
            const a = mark.points[index - 1], z = mark.points[index];
            page.drawLine({ start: { x: a.x * sx, y: height - a.y * sy }, end: { x: z.x * sx, y: height - z.y * sy }, thickness: (mark.type === 'highlight' ? 16 : mark.width) * sx, color: rgb(r, g, b), opacity: mark.type === 'highlight' ? .28 : 1 });
          }
        }
      }
      if (signature) {
        const bytes = await signature.arrayBuffer(), embedded = signature.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = pages[pageNo - 1], scaled = embedded.scaleToFit(180, 70);
        page.drawImage(embedded, { x: 70, y: 70, width: scaled.width, height: scaled.height });
      }
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator('Paperframe Studio'); doc.setProducer('Paperframe Studio');
      savePdf(await doc.save({ useObjectStreams: true }), `${item.name.replace(/\.pdf$/i, '')}-annotated.pdf`); notify('Annotated PDF downloaded');
    } catch { notify('Could not export annotations'); }
    setBusy(false);
  };
  if (!item) return <ToolDrop title="Drop one PDF to annotate or sign" onFiles={add} />;
  const visibleMarks = [...marks.filter(mark => mark.page === pageNo), ...(drawing ? [drawing] : [])];
  return <div className="annotation-workarea"><DocumentBar item={item} icon={<PenToolIcon />} onReplace={() => { setItem(null); setMarks([]); }} />
    <div className="annotation-toolbar"><div className="annotation-modes">{[['pen', 'Draw'], ['highlight', 'Highlight'], ['redact', 'Redact']].map(([id, label]) => <button key={id} className={mode === id ? 'selected' : ''} onClick={() => setMode(id)}>{label}</button>)}</div>
      <input type="color" title="Annotation color" value={color} onChange={event => setColor(event.target.value)} />
      <label>Width <input type="range" min="1" max="12" value={lineWidth} onChange={event => setLineWidth(Number(event.target.value))} /></label>
      <button className="secondary" onClick={() => addStamp('APPROVED')}>Approved</button><button className="secondary" onClick={() => addStamp('DRAFT')}>Draft</button>
      <label className="signature-upload"><span>Signature image</span><input type="file" accept="image/png,image/jpeg" onChange={event => setSignature(event.target.files[0])} /></label>
      <IconButton label="Undo last annotation" disabled={!marks.length} onClick={() => setMarks(current => current.slice(0, -1))}><Undo2 size={15} /></IconButton></div>
    <div className="annotation-page-bar"><button disabled={pageNo <= 1} onClick={() => setPageNo(value => value - 1)}><ArrowLeft size={14} /></button><span>Page {pageNo} of {item.pages}</span><button disabled={pageNo >= item.pages} onClick={() => setPageNo(value => value + 1)}><ArrowRight size={14} /></button></div>
    <div className="annotation-scroll"><div ref={surfaceRef} className={`annotation-surface mode-${mode}`} onPointerDown={startMark} onPointerMove={continueMark} onPointerUp={finishMark} onPointerCancel={finishMark}>
      <canvas ref={canvasRef} />
      <svg className="annotation-overlay">{visibleMarks.map(mark => mark.type === 'stamp' ? <text key={mark.id} x={mark.x} y={mark.y} className="stamp-mark">{mark.text}</text>
        : mark.type === 'redact' ? <rect key={mark.id} x={Math.min(mark.points[0].x, mark.points.at(-1).x)} y={Math.min(mark.points[0].y, mark.points.at(-1).y)} width={Math.abs(mark.points.at(-1).x - mark.points[0].x)} height={Math.abs(mark.points.at(-1).y - mark.points[0].y)} fill="#000" />
          : <polyline key={mark.id} points={mark.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={mark.color} strokeWidth={mark.type === 'highlight' ? 16 : mark.width} strokeOpacity={mark.type === 'highlight' ? .28 : 1} strokeLinecap="round" strokeLinejoin="round" />)}</svg>
    </div></div>
    <button className="primary tool-main-action" disabled={busy} onClick={exportAnnotated}>{busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Download annotated PDF</button>
  </div>;
}

function PenToolIcon() { return <Move size={24} />; }

function ConvertTool({ notify }) {
  const [mode, setMode] = useState('images'), [busy, setBusy] = useState(false);
  const imageRef = useRef(), pdfRef = useRef();
  const imagesToPdf = async files => {
    if (!files.length) return; setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const file of [...files]) {
        const bytes = await file.arrayBuffer(), image = file.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([595.28, 841.89]), scaled = image.scaleToFit(555.28, 801.89);
        page.drawImage(image, { x: (595.28 - scaled.width) / 2, y: (841.89 - scaled.height) / 2, width: scaled.width, height: scaled.height });
      }
      savePdf(await doc.save({ useObjectStreams: true }), 'paperframe-images.pdf'); notify(`${files.length} images converted to PDF`);
    } catch { notify('Could not convert these images'); } setBusy(false);
  };
  const pdfToImages = async files => {
    if (!files.length) return; setBusy(true);
    try {
      const bytes = new Uint8Array(await files[0].arrayBuffer()), loading = pdfjsLib.getDocument({ data: bytes }), pdf = await loading.promise;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 2 }), canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `page-${number}.png`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
      }
      await loading.destroy(); notify(`${pdf.numPages} page images created`);
    } catch { notify('Could not convert this PDF'); } setBusy(false);
  };
  return <div className="convert-workarea"><div className="edit-kind"><button className={mode === 'images' ? 'selected' : ''} onClick={() => setMode('images')}>Images to PDF</button><button className={mode === 'pdf' ? 'selected' : ''} onClick={() => setMode('pdf')}>PDF to PNG</button></div>
    {mode === 'images' ? <><input ref={imageRef} hidden type="file" multiple accept="image/png,image/jpeg" onChange={event => imagesToPdf(event.target.files)} /><button className="pdf-drop" disabled={busy} onClick={() => imageRef.current.click()}><div>{busy ? <LoaderCircle className="spin" size={24} /> : <ImageIcon size={24} />}</div><strong>Choose PNG or JPEG images</strong><span>One centered A4 page will be created per image</span></button></>
      : <><input ref={pdfRef} hidden type="file" accept=".pdf,application/pdf" onChange={event => pdfToImages(event.target.files)} /><button className="pdf-drop" disabled={busy} onClick={() => pdfRef.current.click()}><div>{busy ? <LoaderCircle className="spin" size={24} /> : <FileText size={24} />}</div><strong>Choose one PDF</strong><span>Each page will download as a high-resolution PNG</span></button></>}
  </div>;
}

function CompareTool({ notify }) {
  const [first, setFirst] = useState(null), [second, setSecond] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  const readTextPages = async file => {
    const data = new Uint8Array(await file.arrayBuffer()), loading = pdfjsLib.getDocument({ data }), pdf = await loading.promise, pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim());
    }
    await loading.destroy(); return pages;
  };
  const compare = async () => {
    if (!first || !second) return notify('Choose two PDFs first'); setBusy(true);
    try {
      const [a, b] = await Promise.all([readTextPages(first), readTextPages(second)]), total = Math.max(a.length, b.length), changed = [];
      for (let index = 0; index < total; index++) if ((a[index] || '') !== (b[index] || '')) changed.push(index + 1);
      setResult({ pagesA: a.length, pagesB: b.length, changed }); notify(changed.length ? `${changed.length} changed pages detected` : 'No text differences detected');
    } catch { notify('Could not compare these PDFs'); } setBusy(false);
  };
  return <div className="compare-workarea"><div className="compare-files"><label><span>Original PDF</span><input type="file" accept=".pdf,application/pdf" onChange={event => { setFirst(event.target.files[0]); setResult(null); }} /><strong>{first?.name || 'Choose original'}</strong></label>
    <div><ArrowRight size={21} /></div><label><span>Revised PDF</span><input type="file" accept=".pdf,application/pdf" onChange={event => { setSecond(event.target.files[0]); setResult(null); }} /><strong>{second?.name || 'Choose revised'}</strong></label></div>
    <button className="primary tool-main-action" disabled={!first || !second || busy} onClick={compare}>{busy ? <LoaderCircle className="spin" size={16} /> : <Copy size={16} />} Compare document text</button>
    {result && <div className={`compare-result ${result.changed.length ? 'different' : 'same'}`}><strong>{result.changed.length ? `${result.changed.length} pages changed` : 'Documents match'}</strong><p>Original: {result.pagesA} pages · Revised: {result.pagesB} pages</p>{result.changed.length > 0 && <span>Changed pages: {result.changed.join(', ')}</span>}</div>}
    <div className="comparison-note">This local comparison detects text and page-count changes. Scanned image differences require OCR first.</div></div>;
}

function EditTool({ notify }) {
  const [item, setItem] = useState(null), [kind, setKind] = useState('visual'), [page, setPage] = useState(1), [text, setText] = useState('Approved');
  const [size, setSize] = useState(24), [x, setX] = useState(10), [y, setY] = useState(10), [color, setColor] = useState('#d8673f'), [image, setImage] = useState(null), [busy, setBusy] = useState(false);
  const [detectedText, setDetectedText] = useState([]), [selectedText, setSelectedText] = useState(''), [replacement, setReplacement] = useState(''), [scanning, setScanning] = useState(false);
  const [visualItems, setVisualItems] = useState([]), [visualSelected, setVisualSelected] = useState(null), [rendering, setRendering] = useState(false);
  const [editUndo, setEditUndo] = useState([]), [editRedo, setEditRedo] = useState([]);
  const [visualEditsByPage, setVisualEditsByPage] = useState({});
  const [ocrLanguage, setOcrLanguage] = useState('eng'), [ocrProgress, setOcrProgress] = useState(null);
  const canvasRef = useRef(), visualScale = 1.25;
  const add = async files => { try { const loaded = await loadPdfItem(files[0]); setItem(loaded); setDetectedText([]); setVisualEditsByPage({}); if (loaded.repaired) notify('Incomplete image-only PDF repaired automatically'); } catch { notify('Could not read this PDF'); } };
  useEffect(() => {
    if (!item || kind !== 'visual') return;
    let cancelled = false, loading;
    const renderVisualPage = async () => {
      setRendering(true); setVisualSelected(null); setEditUndo([]); setEditRedo([]);
      try {
        const data = item.bytes instanceof Uint8Array ? item.bytes.slice() : new Uint8Array(item.bytes.slice(0));
        loading = pdfjsLib.getDocument({ data });
        const pdf = await loading.promise, pdfPage = await pdf.getPage(Math.max(1, Math.min(item.pages, page)));
        const viewport = pdfPage.getViewport({ scale: visualScale }), canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2), context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        await pdfPage.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
        const content = await pdfPage.getTextContent();
        const fragments = content.items.filter(entry => entry.str?.trim()).map((entry, index) => {
          const transform = pdfjsLib.Util.transform(viewport.transform, entry.transform);
          const fontHeight = Math.max(6, Math.hypot(transform[2], transform[3]));
          return {
            id: `${page}-${index}`, text: entry.str, originalText: entry.str, left: transform[4],
            top: transform[5] - fontHeight, width: Math.max(entry.width * visualScale, 12), height: fontHeight * 1.18,
            pdfX: entry.transform[4], pdfY: entry.transform[5], pdfWidth: Math.max(entry.width, 2),
            pdfHeight: Math.max(entry.height || Math.abs(entry.transform[3]) || 8, 6),
            color: '#111111', bold: false, changed: false
          };
        });
        const boxes = [];
        for (const fragment of fragments) {
          const previous = boxes[boxes.length - 1];
          const previousRight = previous ? previous.left + previous.width : 0;
          const sameLine = previous && Math.abs(previous.top - fragment.top) <= Math.max(previous.height, fragment.height) * .42;
          const gap = fragment.left - previousRight;
          const closeEnough = gap >= -2 && gap <= Math.max(previous.height, fragment.height) * 2.2;
          if (sameLine && closeEnough) {
            const separator = gap > Math.max(previous.height, fragment.height) * .18 ? ' ' : '';
            previous.text += `${separator}${fragment.text}`;
            previous.originalText = previous.text;
            previous.width = Math.max(previous.width, fragment.left + fragment.width - previous.left);
            previous.pdfWidth = Math.max(previous.pdfWidth, fragment.pdfX + fragment.pdfWidth - previous.pdfX);
            previous.height = Math.max(previous.height, fragment.height);
            previous.pdfHeight = Math.max(previous.pdfHeight, fragment.pdfHeight);
          } else boxes.push({ ...fragment, id: `${page}-${boxes.length}` });
        }
        if (!cancelled) {
          setVisualItems(visualEditsByPage[page] || boxes);
          if (!boxes.length && !visualEditsByPage[page]?.length) notify('This page is image-only. OCR is required before its text can be edited.');
        }
      } catch { if (!cancelled) notify('Could not render this PDF page'); }
      if (!cancelled) setRendering(false);
    };
    renderVisualPage();
    return () => { cancelled = true; loading?.destroy(); };
  }, [item, page, kind]);
  const visualSnapshot = () => visualItems.map(entry => ({ ...entry }));
  const updateVisual = (id, patch) => {
    setEditUndo(history => [...history.slice(-39), visualSnapshot()]); setEditRedo([]);
    setVisualItems(items => {
      const next = items.map(entry => entry.id === id ? { ...entry, ...patch, changed: true } : entry);
      setVisualEditsByPage(current => ({ ...current, [page]: next })); return next;
    });
  };
  const undoVisual = () => {
    if (!editUndo.length) return;
    setEditRedo(history => [...history, visualSnapshot()]);
    const previous = editUndo[editUndo.length - 1]; setVisualItems(previous); setVisualEditsByPage(current => ({ ...current, [page]: previous })); setEditUndo(history => history.slice(0, -1));
  };
  const redoVisual = () => {
    if (!editRedo.length) return;
    setEditUndo(history => [...history, visualSnapshot()]);
    const next = editRedo[editRedo.length - 1]; setVisualItems(next); setVisualEditsByPage(current => ({ ...current, [page]: next })); setEditRedo(history => history.slice(0, -1));
  };
  const runOcr = async () => {
    if (!canvasRef.current) return;
    setOcrProgress(1);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(ocrLanguage, 1, {
        logger: message => {
          if (message.status === 'recognizing text') setOcrProgress(Math.max(1, Math.round(message.progress * 100)));
        }
      });
      const result = await worker.recognize(canvasRef.current, {}, { blocks: true });
      const lines = [];
      const collect = blocks => (blocks || []).forEach(block => (block.paragraphs || []).forEach(paragraph => (paragraph.lines || []).forEach(line => {
        if (line.text?.trim() && line.bbox) lines.push({ text: line.text.trim(), bbox: line.bbox });
      })));
      collect(result.data.blocks);
      if (!lines.length && result.data.words) result.data.words.filter(word => word.text?.trim()).forEach(word => lines.push({ text: word.text.trim(), bbox: word.bbox }));
      const canvas = canvasRef.current, cssWidth = parseFloat(canvas.style.width) || canvas.width, cssHeight = parseFloat(canvas.style.height) || canvas.height;
      const imageScaleX = cssWidth / canvas.width, imageScaleY = cssHeight / canvas.height;
      const recognized = lines.map((line, index) => {
        const left = line.bbox.x0 * imageScaleX, top = line.bbox.y0 * imageScaleY;
        const width = Math.max((line.bbox.x1 - line.bbox.x0) * imageScaleX, 15), height = Math.max((line.bbox.y1 - line.bbox.y0) * imageScaleY, 10);
        return {
          id: `ocr-${page}-${index}`, text: line.text, originalText: line.text, left, top, width, height,
          pdfX: left / visualScale, pdfY: (cssHeight - top - height) / visualScale,
          pdfWidth: width / visualScale, pdfHeight: height / visualScale,
          color: '#111111', bold: false, changed: false, ocr: true
        };
      });
      setVisualItems(recognized); setVisualEditsByPage(current => ({ ...current, [page]: recognized })); setVisualSelected(null);
      await worker.terminate();
      notify(recognized.length ? `${recognized.length} editable OCR text lines created` : 'OCR could not detect readable text');
    } catch (error) { console.error(error); notify('OCR failed. Check the language and image quality.'); }
    setOcrProgress(null);
  };
  const scanPageText = async () => {
    setScanning(true);
    try {
      const data = item.bytes instanceof Uint8Array ? item.bytes.slice() : new Uint8Array(item.bytes.slice(0));
      const loading = pdfjsLib.getDocument({ data }), pdf = await loading.promise, pdfPage = await pdf.getPage(Math.max(1, Math.min(item.pages, page)));
      const content = await pdfPage.getTextContent();
      const found = content.items.filter(entry => entry.str?.trim()).map((entry, index) => ({
        id: String(index), text: entry.str, x: entry.transform[4], y: entry.transform[5],
        width: Math.max(entry.width || 1, 1), height: Math.max(entry.height || Math.abs(entry.transform[3]) || 10, 6)
      }));
      setDetectedText(found);
      if (found.length) { setSelectedText(found[0].id); setReplacement(found[0].text); notify(`${found.length} editable text elements detected`); }
      else { setSelectedText(''); notify('No selectable text found — this page appears to be scanned or image-only'); }
      await loading.destroy();
    } catch { setDetectedText([]); notify('Could not analyze text on this page'); }
    setScanning(false);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const doc = await PDFDocument.load(item.bytes), target = doc.getPage(Math.max(0, Math.min(item.pages - 1, page - 1))), box = target.getSize();
      const px = box.width * x / 100, py = box.height * (1 - y / 100), channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
      if (kind === 'visual') {
        const allEdits = { ...visualEditsByPage, [page]: visualItems };
        const changedPages = Object.entries(allEdits).map(([number, entries]) => [Number(number), entries.filter(entry => entry.changed)]).filter(([, entries]) => entries.length);
        if (!changedPages.length) throw Error('Edit some text directly on the page first');
        const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
        for (const [editedPageNumber, entries] of changedPages) for (const entry of entries) {
          const editedPage = doc.getPage(editedPageNumber - 1);
          const [er, eg, eb] = [1, 3, 5].map(index => parseInt(entry.color.slice(index, index + 2), 16) / 255);
          const lineHeight = entry.pdfHeight * 1.15;
          const availableWidth = Math.max(entry.pdfWidth, 25);
          const approximateChars = Math.max(1, Math.floor(availableWidth / (entry.pdfHeight * .52)));
          const words = entry.text.split(/\s+/), lines = []; let line = '';
          for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (candidate.length > approximateChars && line) { lines.push(line); line = word; } else line = candidate;
          }
          if (line || !lines.length) lines.push(line);
          editedPage.drawRectangle({ x: entry.pdfX - 1.5, y: entry.pdfY - 2, width: availableWidth + 3, height: Math.max(entry.pdfHeight + 4, lines.length * lineHeight + 3), color: rgb(1, 1, 1) });
          lines.forEach((content, lineIndex) => editedPage.drawText(content || ' ', {
            x: entry.pdfX, y: entry.pdfY - lineIndex * lineHeight, size: entry.pdfHeight,
            font: entry.bold ? bold : regular, color: rgb(er, eg, eb)
          }));
        }
      } else if (kind === 'replace') {
        const original = detectedText.find(entry => entry.id === selectedText);
        if (!original) throw Error('Scan the page and select text first');
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const replacementSize = Math.max(6, Math.min(120, original.height));
        target.drawRectangle({ x: original.x - 1, y: original.y - 2, width: original.width + 3, height: original.height + 4, color: rgb(1, 1, 1) });
        target.drawText(replacement || ' ', { x: original.x, y: original.y, size: replacementSize, font, color: rgb(...channels), maxWidth: Math.max(original.width * 2, 40) });
      } else if (kind === 'text') {
        const font = await doc.embedFont(StandardFonts.HelveticaBold); target.drawText(text || 'Text', { x: px, y: py - size, size, font, color: rgb(...channels) });
      } else if (kind === 'shape') target.drawRectangle({ x: px, y: py - 70, width: box.width * .25, height: 70, borderWidth: 3, borderColor: rgb(...channels) });
      else {
        if (!image) throw Error('Choose a PNG or JPEG image');
        const bytes = await image.arrayBuffer(), embedded = image.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes), scaled = embedded.scaleToFit(box.width * .3, box.height * .3);
        target.drawImage(embedded, { x: px, y: py - scaled.height, width: scaled.width, height: scaled.height });
      }
      savePdf(await doc.save({ useObjectStreams: true }), `${item.name.replace(/\.pdf$/i, '')}-edited.pdf`); notify('Edited PDF downloaded');
    } catch (error) { notify(error.message || 'Could not edit PDF'); } setBusy(false);
  };
  if (!item) return <ToolDrop title="Drop one PDF to edit" onFiles={add} />;
  return <div className="tool-workarea"><DocumentBar item={item} icon={<Settings2 size={24} />} onReplace={() => setItem(null)} />
    <div className="edit-kind five"><button className={kind === 'visual' ? 'selected' : ''} onClick={() => setKind('visual')}>Visual editor</button><button className={kind === 'replace' ? 'selected' : ''} onClick={() => setKind('replace')}>Text list</button><button className={kind === 'text' ? 'selected' : ''} onClick={() => setKind('text')}>Add text</button><button className={kind === 'image' ? 'selected' : ''} onClick={() => setKind('image')}>Add image</button><button className={kind === 'shape' ? 'selected' : ''} onClick={() => setKind('shape')}>Rectangle</button></div>
    {kind === 'visual' && <div className="visual-pdf-editor">
      <div className="visual-editor-bar">
        <div className="page-stepper"><IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ArrowLeft size={15} /></IconButton><span>Page <b>{page}</b> of {item.pages}</span><IconButton label="Next page" disabled={page >= item.pages} onClick={() => setPage(value => value + 1)}><ArrowRight size={15} /></IconButton></div>
        <div className="visual-history"><IconButton label="Undo text edit" disabled={!editUndo.length} onClick={undoVisual}><Undo2 size={16} /></IconButton><IconButton label="Redo text edit" disabled={!editRedo.length} onClick={redoVisual}><Redo2 size={16} /></IconButton></div>
        <div className="ocr-controls"><select aria-label="OCR language" value={ocrLanguage} onChange={e => setOcrLanguage(e.target.value)}><option value="eng">English OCR</option><option value="hin">Hindi OCR</option><option value="ben">Bengali OCR</option><option value="ori">Odia OCR</option></select>
          <button className="secondary" disabled={ocrProgress !== null || rendering} onClick={runOcr}>{ocrProgress !== null ? <><LoaderCircle className="spin" size={14} /> {ocrProgress}%</> : <><FileText size={14} /> Recognize scan</>}</button></div>
        {visualSelected && <div className="inline-format"><label>Size <input type="number" min="6" max="120" value={Math.round(visualItems.find(entry => entry.id === visualSelected)?.pdfHeight || 10)} onChange={e => updateVisual(visualSelected, { pdfHeight: Number(e.target.value), height: Number(e.target.value) * visualScale * 1.18 })} /></label>
          <input title="Text color" type="color" value={visualItems.find(entry => entry.id === visualSelected)?.color || '#111111'} onChange={e => updateVisual(visualSelected, { color: e.target.value })} />
          <button className={visualItems.find(entry => entry.id === visualSelected)?.bold ? 'active' : ''} onClick={() => { const current = visualItems.find(entry => entry.id === visualSelected); updateVisual(visualSelected, { bold: !current.bold }); }}>B</button></div>}
      </div>
      <div className="visual-page-scroll">
        <div className="visual-page-wrap">
          <canvas ref={canvasRef} />
          <div className="visual-text-layer">{visualItems.map(entry => {
            const selected = entry.id === visualSelected;
            const estimatedLines = Math.max(1, Math.ceil(entry.text.length / Math.max(1, entry.width / (entry.height * .46))));
            const boxHeight = Math.max(entry.height, estimatedLines * entry.height);
            return selected ? <textarea key={entry.id} autoFocus value={entry.text} style={{ left: entry.left, top: entry.top, width: Math.max(entry.width, 35), height: boxHeight, fontSize: entry.height / 1.18, color: entry.color, fontWeight: entry.bold ? 700 : 400 }}
                onChange={e => updateVisual(entry.id, { text: e.target.value })} />
              : <button key={entry.id} title={entry.text} className={entry.changed ? 'changed' : ''} style={{ left: entry.left, top: entry.top, width: Math.max(entry.width, 12), height: Math.max(entry.height, 10) }}
                onClick={() => setVisualSelected(entry.id)}>{entry.changed ? <span style={{ fontSize: entry.height / 1.18, color: entry.color, fontWeight: entry.bold ? 700 : 400 }}>{entry.text}</span> : null}</button>;
          })}</div>
          {rendering && <div className="visual-loading"><LoaderCircle className="spin" size={22} /> Rendering page</div>}
        </div>
      </div>
      <div className="visual-help"><Move size={15} /><span>Click selectable text directly. For scanned pages, choose a language and use “Recognize scan”; OCR models run locally after first download.</span></div>
    </div>}
    {kind !== 'visual' && <div className="edit-fields"><label className="pdf-tool-field"><span>Page</span><input type="number" min="1" max={item.pages} value={page} onChange={e => setPage(Number(e.target.value))} /></label>
      {kind !== 'replace' && <><label className="pdf-tool-field"><span>X position (% from left)</span><input type="number" min="0" max="90" value={x} onChange={e => setX(Number(e.target.value))} /></label>
      <label className="pdf-tool-field"><span>Y position (% from top)</span><input type="number" min="0" max="95" value={y} onChange={e => setY(Number(e.target.value))} /></label></>}
      <label className="pdf-tool-field"><span>Color</span><input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
      {kind === 'replace' && <><div className="scan-text-action wide"><button className="secondary" disabled={scanning} onClick={scanPageText}>{scanning ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />} Scan page for editable text</button><small>Works with selectable text. Scanned photographs require OCR.</small></div>
        <label className="pdf-tool-field wide"><span>Detected inner content</span><select value={selectedText} onChange={e => { const id = e.target.value; setSelectedText(id); setReplacement(detectedText.find(entry => entry.id === id)?.text || ''); }} disabled={!detectedText.length}>
          {!detectedText.length && <option>No text scanned yet</option>}{detectedText.map(entry => <option key={entry.id} value={entry.id}>{entry.text}</option>)}</select></label>
        <label className="pdf-tool-field wide"><span>Replacement text</span><input value={replacement} onChange={e => setReplacement(e.target.value)} disabled={!detectedText.length} /></label></>}
      {kind === 'text' && <><label className="pdf-tool-field wide"><span>Text</span><input value={text} onChange={e => setText(e.target.value)} /></label><label className="pdf-tool-field"><span>Font size</span><input type="number" min="6" max="120" value={size} onChange={e => setSize(Number(e.target.value))} /></label></>}
      {kind === 'image' && <label className="pdf-tool-field wide"><span>PNG or JPEG image</span><input type="file" accept="image/png,image/jpeg" onChange={e => setImage(e.target.files[0])} /></label>}</div>}
    <button className="primary tool-main-action" disabled={busy} onClick={apply}><Download size={16} /> Apply and download</button></div>;
}

function PdfWorkspace() {
  const [active, setActive] = useState('merge'), [toast, setToast] = useState('');
  const notify = message => { setToast(message); setTimeout(() => setToast(''), 2600); };
  const definitions = [
    ['merge', 'Merge PDF', 'Combine PDFs in the order you want.', <Layers3 size={25} />, 'coral'],
    ['organize', 'Organize PDF', 'Reorder, rotate, duplicate, and delete pages.', <Grid2X2 size={25} />, 'blue'],
    ['split', 'Split PDF', 'Extract ranges or individual pages.', <Scissors size={25} />, 'orange'],
    ['compress', 'Compress PDF', 'Optimize size without visible quality loss.', <Maximize2 size={25} />, 'green'],
    ['annotate', 'Annotate & Sign', 'Draw, highlight, redact, stamp, and sign.', <Move size={25} />, 'teal'],
    ['convert', 'Convert', 'Images to PDF or PDF pages to PNG.', <RefreshCcw size={25} />, 'gold'],
    ['compare', 'Compare PDF', 'Find page and text differences locally.', <Copy size={25} />, 'navy'],
    ['edit', 'Edit PDF', 'Add text, images, or shapes.', <Settings2 size={25} />, 'purple']
  ];
  const current = definitions.find(item => item[0] === active);
  return <div className="pdf-workspace new-pdf-tools"><div className="pdf-hero tool-hero"><div><span className="eyebrow"><Sparkles size={13} /> PRIVATE PDF STUDIO</span><h1>Everything your PDF needs.</h1><p>Merge, split, compress, and add content—all locally in your browser.</p></div></div>
    <div className="pdf-tool-shell"><div className="pdf-tool-cards">{definitions.map(([id, title, description, icon, color]) => <button key={id} className={`pdf-tool-card ${color} ${active === id ? 'selected' : ''}`} onClick={() => setActive(id)}>
      <span className="tool-card-icon">{icon}</span><strong>{title}</strong><p>{description}</p><span>Open tool <ArrowRight size={14} /></span></button>)}</div>
      <div className="active-tool-title"><div><span className={`tool-card-icon ${current[4]}`}>{current[3]}</span><div><small>ACTIVE TOOL</small><h2>{current[1]}</h2></div></div><span><Check size={13} /> Files stay on this device</span></div>
      <div className="active-tool-panel">{active === 'merge' && <MergeTool notify={notify} />}{active === 'organize' && <OrganizeTool notify={notify} />}{active === 'split' && <SplitTool notify={notify} />}{active === 'compress' && <CompressTool notify={notify} />}{active === 'annotate' && <AnnotateTool notify={notify} />}{active === 'convert' && <ConvertTool notify={notify} />}{active === 'compare' && <CompareTool notify={notify} />}{active === 'edit' && <EditTool notify={notify} />}</div>
    </div><Toast message={toast} /></div>;
}

function App() {
  const [mode, setModeState] = useState(() => window.location.hash === '#pdf' ? 'pdf' : 'photos');
  const setMode = next => {
    setModeState(next);
    history.replaceState(null, '', next === 'pdf' ? '#pdf' : window.location.pathname);
  };
  return <div className="app">
    <header className="app-header">
      <button className="brand" onClick={() => setMode('photos')}><span className="brand-mark"><img src="/assets/paperframe-logo.png" alt="" /></span><span>Paperframe<small>STUDIO</small></span></button>
      <nav>
        <button className={mode === 'photos' ? 'active' : ''} onClick={() => setMode('photos')}><ImageIcon size={16} /> Photo layout</button>
        <button className={mode === 'pdf' ? 'active' : ''} onClick={() => setMode('pdf')}><FileText size={16} /> PDF tools</button>
      </nav>
      <div className="header-right"><a className="privacy" href="/privacy.html" title="Read the privacy policy"><span /> Private by design</a><a className="help" href="/help.html" aria-label="Help and frequently asked questions">?</a></div>
    </header>
    {mode === 'photos' ? <PhotoWorkspace /> : <PdfWorkspace />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
