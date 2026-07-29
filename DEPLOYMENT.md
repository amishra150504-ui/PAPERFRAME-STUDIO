# Paperframe Studio deployment

## Cloudflare Pages settings

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`
- Environment variable: `SITE_URL` = the final HTTPS website address, without a trailing slash

The first deployment creates the free `*.pages.dev` address. Copy that address, add it as
the `SITE_URL` production environment variable, and retry the deployment. The build then
creates `sitemap.xml`, adds its location to `robots.txt`, and adds canonical links.

## Post-deployment checks

Open all of these URLs and confirm that each returns a page:

- `/`
- `/about.html`
- `/help.html`
- `/privacy.html`
- `/robots.txt`
- `/sitemap.xml`
- `/manifest.webmanifest`

## Search engines

1. Add the complete HTTPS address as a URL-prefix property in Google Search Console.
2. Verify it using the HTML-tag method. Put Google's supplied verification meta tag in
   `index.html`, rebuild, and deploy.
3. Submit `sitemap.xml` in Search Console.
4. Inspect the homepage URL and request indexing.
5. In Bing Webmaster Tools, import the verified Google Search Console property.
6. Confirm that Bing imported the sitemap, or submit `sitemap.xml` manually.

Search-engine submission requests discovery; it cannot guarantee indexing or ranking.
