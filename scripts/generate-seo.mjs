import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('dist');
if (!existsSync(output)) throw new Error('Build output not found. Run Vite before generating SEO files.');
const rawUrl = String(process.env.SITE_URL || '').trim();
if (!rawUrl) {
  console.warn('SITE_URL is not set. Add it after receiving the deployed HTTPS address, then redeploy to generate the sitemap and canonical URLs.');
  writeFileSync(resolve(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  process.exit(0);
}
let site;
try { site = new URL(rawUrl); } catch { throw new Error('SITE_URL must be complete, for example https://paperframe.pages.dev'); }
if (site.protocol !== 'https:') throw new Error('SITE_URL must use HTTPS.');
site.pathname = '/'; site.search = ''; site.hash = '';
const base = site.toString().replace(/\/$/, '');
const pages = ['/', '/about.html', '/help.html', '/privacy.html'];
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(path => `  <url><loc>${base}${path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(resolve(output, 'sitemap.xml'), sitemap);
writeFileSync(resolve(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
for (const file of ['index.html', 'about.html', 'help.html', 'privacy.html']) {
  const path = resolve(output, file);
  const pagePath = file === 'index.html' ? '/' : `/${file}`;
  const html = readFileSync(path, 'utf8').replace('</head>', `<link rel="canonical" href="${base}${pagePath}">\n</head>`);
  writeFileSync(path, html);
}
console.log(`SEO files generated for ${base}`);
