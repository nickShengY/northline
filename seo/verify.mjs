import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../apps/web-portal/', import.meta.url));
const built = process.argv.includes('--dist');
const pub = resolve(root, built ? 'dist' : 'public');
const base = 'https://northline.robopioneer.ca';
const sitemap = readFileSync(resolve(pub, 'sitemap.xml'),'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
assert.equal(urls.length,4);
for (const url of urls) {
 const path = new URL(url).pathname;
 const html = path === '/' && !built
   ? readFileSync(resolve(root, 'index.html'), 'utf8').replace('<!-- northline-overview -->', readFileSync(resolve(root, 'src/content/overview.html'), 'utf8'))
   : readFileSync(resolve(pub, `.${path}index.html`),'utf8');
 assert.equal((html.match(/<h1[ >]/g)||[]).length,1,`${path}: one h1`);
 assert(html.includes(`rel="canonical" href="${url}"`),`${path}: canonical`);
 assert(!html.includes('northline-overview'),`${path}: rendered overview`);
 assert(html.includes('Sign in'),`${path}: conversion link`);
 for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1]);
 for (const [,href] of html.matchAll(/href="(\/(?!\/)[^"]*)"/g)) {
  const pathname = href.split('#')[0];
  if (!pathname || pathname === '/') continue;
  assert(existsSync(resolve(pub, `.${pathname}${pathname.endsWith('/')?'index.html':''}`)),`${path}: local link ${href}`);
 }
}
assert(readFileSync(resolve(pub,'robots.txt'),'utf8').includes(`Sitemap: ${base}/sitemap.xml`));
console.log(`Verified ${built?'built':'source'} public pages, canonicals, headings, structured data, internal links, and sitemap.`);
