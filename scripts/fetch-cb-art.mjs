#!/usr/bin/env node
// Download license-checked paintings from Wikimedia Commons for the Crystal Bridges galleries.
//
//   node scripts/fetch-cb-art.mjs [--only <id>]... [--metadata-only]
//
// Node port of musewalk's scripts/fetch_art.py (https://github.com/shuyan-5200/musewalk,
// MIT, Copyright (c) 2026 Musewalk contributors; see credits/crystal-bridges.md). Same policy:
// every file is resolved through the Commons API and accepted ONLY when Commons reports
// "Public domain", "CC0" or "CC BY <version>" (ShareAlike, NonCommercial and unknown/missing
// licenses are rejected; CC BY additionally needs Artist/Credit and LicenseUrl metadata).
// Search fallbacks are discovery hints only: every candidate gets the same full license check.
//
// Output: public/art/crystal-bridges/<id>.jpg and the manifest public/art/sources.json
// (title, artist, year, room, Commons page, license, credit, sha256, size). Requests are
// sequential and paced (Commons rate-limits bursts). Only works held by Crystal Bridges (file
// titles from Commons' "Paintings in the Crystal Bridges Museum of American Art" category).
// Modern, still-copyrighted works are NEVER fetched: the galleries show an empty frame plus
// the real label for those (public/data/crystal-bridges.config.json, "placeholder": true).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'art', 'crystal-bridges');
const MANIFEST = path.join(ROOT, 'public', 'art', 'sources.json');
const API = 'https://commons.wikimedia.org/w/api.php';
// Generic client name only (no personal contact details; AGENTS.md privacy rule).
const UA = 'BentonvilleRoyale-art-fetch/0.1 (open-source game prototype; Commons provenance downloader)';
const MIN_FILE_BYTES = 12000;
const MAX_FILE_BYTES = 2_500_000;
const PACE_MS = 4000;
const CB = ' - Crystal Bridges Museum of American Art.jpg';

// [id, exact Commons file title, search fallback, thumb width, { title, artist, year, room }]
// Rooms match the wings in public/data/crystal-bridges.config.json.
export const WORKS = [
  ['durand-kindred-spirits', 'Asher B. Durand - Kindred Spirits - 2010.106' + CB, 'Kindred Spirits Durand Crystal Bridges', 1400, { title: 'Kindred Spirits', artist: 'Asher B. Durand', year: '1849', room: 'early-american' }],
  ['church-home-by-the-lake', 'Frederic Church - Home by the Lake - 2008.16' + CB, 'Home by the Lake Church Crystal Bridges', 1200, { title: 'Home by the Lake', artist: 'Frederic Edwin Church', year: '1852', room: 'early-american' }],
  ['cole-landscape-with-indian', 'Thomas Cole - Landscape with Indian - 2006.53' + CB, 'Thomas Cole Landscape with Indian Crystal Bridges', 1000, { title: 'Landscape with Indian', artist: 'Thomas Cole', year: '1826–28', room: 'early-american' }],
  ['cole-mount-etna', 'Thomas Cole - View of Mount Etna - 2007.11' + CB, 'Thomas Cole View of Mount Etna Crystal Bridges', 1000, { title: 'View of Mount Etna', artist: 'Thomas Cole', year: '1842', room: 'early-american' }],
  ['cole-good-shepherd', 'Thomas Cole - The Good Shepherd - 2007.10' + CB, 'Thomas Cole Good Shepherd Crystal Bridges', 1000, { title: 'The Good Shepherd', artist: 'Thomas Cole', year: '1848', room: 'early-american' }],
  ['cropsey-backwoods', 'Jasper Francis Cropsey - The Backwoods of America - 2006.100' + CB, 'Cropsey Backwoods of America Crystal Bridges', 1400, { title: 'The Backwoods of America', artist: 'Jasper Francis Cropsey', year: '1858', room: 'early-american' }],
  ['lane-camden-mountains', 'Fitz Henry Lane - View of Camden Mountains from Penobscot Bay - promised gift 1216 view-of-camden-mountains-from-penobscot-bay' + CB, 'Fitz Henry Lane Camden Mountains Penobscot Crystal Bridges', 1200, { title: 'View of Camden Mountains from Penobscot Bay', artist: 'Fitz Henry Lane', year: '1852', room: 'early-american' }],
  ['kensett-mount-washington', 'John Frederick Kensett - View of Mount Washington - 2006.23' + CB, 'Kensett View of Mount Washington Crystal Bridges', 1000, { title: 'View of Mount Washington', artist: 'John Frederick Kensett', year: '1851', room: 'early-american' }],
  ['vanderlyn-niagara', 'John Vanderlyn - Niagara and the Rapids - 2006.54' + CB, 'Vanderlyn Niagara Rapids Crystal Bridges', 1000, { title: 'Niagara and the Rapids', artist: 'John Vanderlyn', year: 'c. 1801–02', room: 'early-american' }],
  ['guy-winter-brooklyn', 'Francis Guy - Winter Scene in Brooklyn - 2006.98' + CB, 'Francis Guy Winter Scene in Brooklyn Crystal Bridges', 1200, { title: 'Winter Scene in Brooklyn', artist: 'Francis Guy', year: 'c. 1819–20', room: 'early-american' }],
  ['duncanson-landscape', 'Robert Seldon Duncanson - Landscape - 2010.104' + CB, 'Duncanson Landscape Crystal Bridges', 1000, { title: 'Landscape', artist: 'Robert Seldon Duncanson', year: '1853', room: 'early-american' }],
  ['woodville-war-news', 'Richard Caton Woodville - War News from Mexico - 2010.74' + CB, 'Woodville War News from Mexico Crystal Bridges', 1000, { title: 'War News from Mexico', artist: 'Richard Caton Woodville', year: '1848', room: 'early-american' }],
  ['bierstadt-indian-encampment', 'Albert Bierstadt - Indian Encampment - 2010.69' + CB, 'Bierstadt Indian Encampment Crystal Bridges', 1200, { title: 'Indian Encampment', artist: 'Albert Bierstadt', year: 'c. 1862', room: 'nineteenth' }],
  ['bierstadt-wharf-scene', 'Albert Bierstadt - Wharf Scene with Ship at Dock - 2010.78' + CB, 'Bierstadt Wharf Scene Crystal Bridges', 1000, { title: 'Wharf Scene with Ship at Dock', artist: 'Albert Bierstadt', year: 'c. 1863', room: 'nineteenth' }],
  ['moran-catawissa', 'Thomas Moran - Valley of the Catawissa in Autumn - 2005.6' + CB, 'Moran Valley of the Catawissa Crystal Bridges', 1200, { title: 'Valley of the Catawissa in Autumn', artist: 'Thomas Moran', year: '1862', room: 'nineteenth' }],
  ['moran-lake-superior', 'Thomas Moran - The Shores of Lake Superior - 2019.32' + CB, 'Moran Shores of Lake Superior Crystal Bridges', 1200, { title: 'The Shores of Lake Superior', artist: 'Thomas Moran', year: '1873', room: 'nineteenth' }],
  ['hill-yosemite-falls', 'Thomas Hill - Yosemite Falls - 2014.12' + CB, 'Thomas Hill Yosemite Falls Crystal Bridges', 1000, { title: 'Yosemite Falls', artist: 'Thomas Hill', year: '1865', room: 'nineteenth' }],
  ['keith-sentinel-rock', 'William Keith - Sentinel Rock, Yosemite - 2010.116' + CB, 'William Keith Sentinel Rock Crystal Bridges', 1000, { title: 'Sentinel Rock, Yosemite', artist: 'William Keith', year: '1872', room: 'nineteenth' }],
  ['inness-old-roadway', 'George Inness - An Old Roadway - promised gift 68 an-old-roadway' + CB, 'George Inness An Old Roadway Crystal Bridges', 1000, { title: 'An Old Roadway', artist: 'George Inness', year: 'c. 1880', room: 'nineteenth' }],
  ['inness-sunset-river', 'George Inness - Sunset on the River - promised gift 716 sunset-on-the-river' + CB, 'George Inness Sunset on the River Crystal Bridges', 1000, { title: 'Sunset on the River', artist: 'George Inness', year: '1867', room: 'nineteenth' }],
  ['johnson-cranberry-pickers', 'Eastman Johnson - Cranberry Pickers, Nantucket - 2010.68' + CB, 'Eastman Johnson Cranberry Pickers Crystal Bridges', 1000, { title: 'Cranberry Pickers, Nantucket', artist: 'Eastman Johnson', year: 'c. 1879', room: 'nineteenth' }],
  ['tait-tight-fix', 'Arthur Fitzwilliam Tait - A Tight Fix—Bear Hunting, Early Winter (The Life of a Hunter, A Tight Fix) - 2010.72' + CB, 'Tait Tight Fix Bear Hunting Crystal Bridges', 1000, { title: 'A Tight Fix—Bear Hunting, Early Winter', artist: 'Arthur Fitzwilliam Tait', year: '1856', room: 'nineteenth' }],
  ['tanner-good-shepherd', 'Henry Ossawa Tanner - The Good Shepherd - 2019.5' + CB, 'Tanner Good Shepherd Crystal Bridges', 1000, { title: 'The Good Shepherd', artist: 'Henry Ossawa Tanner', year: 'c. 1902–03', room: 'nineteenth' }],
  ['sargent-stevenson', 'John Singer Sargent - Robert Louis Stevenson and His Wife - 2005.3' + CB, 'Sargent Robert Louis Stevenson and His Wife Crystal Bridges', 1000, { title: 'Robert Louis Stevenson and His Wife', artist: 'John Singer Sargent', year: '1885', room: 'bridge-gallery' }],
  ['hassam-paris-twilight', 'Childe Hassam - Paris at Twilight - 2005.25' + CB, 'Childe Hassam Paris at Twilight Crystal Bridges', 1000, { title: 'Paris at Twilight', artist: 'Childe Hassam', year: '1888', room: 'bridge-gallery' }],
  ['chase-seaside-flowers', 'William Merritt Chase - Seaside Flowers - 2006.75' + CB, 'Chase Seaside Flowers Crystal Bridges', 1000, { title: 'Seaside Flowers', artist: 'William Merritt Chase', year: 'c. 1890s', room: 'bridge-gallery' }],
  ['cassatt-reader', 'Mary Cassatt - The Reader - promised gift 39 the-reader' + CB, 'Mary Cassatt The Reader Crystal Bridges', 1000, { title: 'The Reader', artist: 'Mary Cassatt', year: '1877', room: 'bridge-gallery', museumSlug: 'a2003-007' }],
  ['robinson-columbian', "Theodore Robinson - World's Columbian Exposition - 2010.73" + CB, 'Theodore Robinson Columbian Exposition Crystal Bridges', 1000, { title: "World's Columbian Exposition", artist: 'Theodore Robinson', year: '1894', room: 'bridge-gallery' }],
  ['twachtman-september', 'John Henry Twachtman - September Sunshine - 2005.16' + CB, 'Twachtman September Sunshine Crystal Bridges', 1000, { title: 'September Sunshine', artist: 'John Henry Twachtman', year: 'c. 1895', room: 'bridge-gallery' }],
  ['ryder-misty-moonlight', 'Albert Pinkham Ryder - Misty Moonlight - 2007.3' + CB, 'Ryder Misty Moonlight Crystal Bridges', 1000, { title: 'Misty Moonlight', artist: 'Albert Pinkham Ryder', year: 'c. 1890', room: 'bridge-gallery' }],
  ['bellows-excavation', 'George Wesley Bellows - Excavation at Night - 2010.77' + CB, 'Bellows Excavation at Night Crystal Bridges', 1000, { title: 'Excavation at Night', artist: 'George Wesley Bellows', year: '1908', room: 'early-twentieth' }],
  ['sloan-bleecker', 'John Sloan - Bleecker Street, Saturday Night - 2005.1' + CB, 'John Sloan Bleecker Street Crystal Bridges', 1000, { title: 'Bleecker Street, Saturday Night', artist: 'John Sloan', year: '1918', room: 'early-twentieth' }],
  ['hartley-mountain-king', 'Marsden Hartley - Hall of the Mountain King - 2010.94' + CB, 'Hartley Hall of the Mountain King Crystal Bridges', 1000, { title: 'Hall of the Mountain King', artist: 'Marsden Hartley', year: '1908–09', room: 'early-twentieth' }],
  ['remington-cowpuncher', "Frederic Remington - Cowpuncher's Lullaby - 2007.180" + CB, 'Remington Cowpuncher Lullaby Crystal Bridges', 1000, { title: "Cowpuncher's Lullaby", artist: 'Frederic Remington', year: '1906', room: 'early-twentieth' }],
  ['bluemner-montville', 'Oscar Bluemner - Motive of Space and Form—A New Jersey Village (Montville) - 2006.14' + CB, 'Bluemner Montville Crystal Bridges', 1000, { title: 'Motive of Space and Form—A New Jersey Village (Montville)', artist: 'Oscar Bluemner', year: '1916–18', room: 'early-twentieth' }],
  // ---- 2026-11 additions (pre-1930, US public domain; every file still passes the Commons license check)
  ['krimmel-village-politicians', 'John L. Krimmel - The Village Politicians - 2007.5' + CB, 'Krimmel Village Politicians Crystal Bridges', 1000, { title: 'The Village Politicians', artist: 'John Lewis Krimmel', year: 'c. 1819', room: 'early-american' }],
  ['catlin-indian-encampment', 'George Catlin - Indian Encampment - 2007.222' + CB, 'George Catlin Indian Encampment Crystal Bridges', 1000, { title: 'Indian Encampment', artist: 'George Catlin', year: 'c. 1830s', room: 'early-american' }],
  ['mcentee-winter-country', 'Jervis McEntee - Winter in the Country - 2006.65' + CB, 'McEntee Winter in the Country Crystal Bridges', 1000, { title: 'Winter in the Country', artist: 'Jervis McEntee', year: '1867', room: 'early-american' }],
  ['pomarede-st-louis', 'Leon Pomarede - View of St. Louis - 2007.16' + CB, 'Pomarede View of St. Louis Crystal Bridges', 1000, { title: 'View of St. Louis', artist: 'Leon Pomarede', year: '1835', room: 'early-american' }],
  ['taylor-classical-landscape', 'John Taylor - A Wooded Classical Landscape at Evening with Figures in the Foreground - 2011.13' + CB, 'John Taylor Wooded Classical Landscape Crystal Bridges', 1000, { title: 'A Wooded Classical Landscape at Evening', artist: 'John Taylor', year: '18th century', room: 'early-american' }],
  ['bannister-harvest', 'Edward Mitchell Bannister - Harvest - 2014.43' + CB, 'Bannister Harvest Crystal Bridges', 1000, { title: 'Harvest', artist: 'Edward Mitchell Bannister', year: 'c. 1880s', room: 'nineteenth' }],
  ['johnson-at-the-camp', 'Eastman Johnson - At the Camp—Spinning Yarns and Whittling - 2010.86' + CB, 'Eastman Johnson At the Camp Crystal Bridges', 1000, { title: 'At the Camp—Spinning Yarns and Whittling', artist: 'Eastman Johnson', year: 'c. 1864–66', room: 'nineteenth' }],
  ['stanley-buffalo-hunt', 'John Mix Stanley - The Buffalo Hunt - 2010.95' + CB, 'John Mix Stanley Buffalo Hunt Crystal Bridges', 1000, { title: 'The Buffalo Hunt', artist: 'John Mix Stanley', year: '1855', room: 'nineteenth' }],
  ['pettit-union-refugees', 'George W. Pettit - Union Refugees - 2011.21' + CB, 'Pettit Union Refugees Crystal Bridges', 1000, { title: 'Union Refugees', artist: 'George W. Pettit', year: '1865', room: 'nineteenth' }],
  ['richards-along-the-shore', 'William Trost Richards - Along the Shore - 2009.1' + CB, 'William Trost Richards Along the Shore Crystal Bridges', 1000, { title: 'Along the Shore', artist: 'William Trost Richards', year: '1881', room: 'nineteenth' }],
  ['brush-indian-lily', 'George de Forest Brush - The Indian and the Lily - 2010.83' + CB, 'Brush Indian and the Lily Crystal Bridges', 1000, { title: 'The Indian and the Lily', artist: 'George de Forest Brush', year: '1887', room: 'nineteenth' }],
  ['ulrich-glass-engraver', 'Charles Frederic Ulrich - The Glass Engraver - 2006.97' + CB, 'Ulrich Glass Engraver Crystal Bridges', 1000, { title: 'The Glass Engraver', artist: 'Charles Frederic Ulrich', year: '1883', room: 'nineteenth' }],
  ['chase-the-song', 'William Merritt Chase - The Song - promised gift 40 the-song' + CB, 'William Merritt Chase The Song Crystal Bridges', 1000, { title: 'The Song', artist: 'William Merritt Chase', year: '1907', room: 'bridge-gallery' }],
  ['sargent-under-willows', 'John Singer Sargent - Under the Willows - promised gift 100 under-the-willows' + CB, 'Sargent Under the Willows Crystal Bridges', 1000, { title: 'Under the Willows', artist: 'John Singer Sargent', year: 'c. 1887', room: 'bridge-gallery' }],
  ['twachtman-yellowstone', 'John Henry Twachtman - Lower Falls of the Yellowstone - promised gift 107 lower-falls-of-the-yellowstone' + CB, 'Twachtman Lower Falls Yellowstone Crystal Bridges', 1000, { title: 'Lower Falls of the Yellowstone', artist: 'John Henry Twachtman', year: '1895', room: 'bridge-gallery' }],
  ['metcalf-pool', 'Willard LeRoy Metcalf - The Pool - promised gift 88 the-pool' + CB, 'Metcalf The Pool Crystal Bridges', 1000, { title: 'The Pool', artist: 'Willard LeRoy Metcalf', year: '1904', room: 'bridge-gallery' }],
  ['dewing-fortune-teller', 'Thomas Wilmer Dewing - The Fortune Teller - 2008.9' + CB, 'Dewing Fortune Teller Crystal Bridges', 1000, { title: 'The Fortune Teller', artist: 'Thomas Wilmer Dewing', year: '1904–05', room: 'bridge-gallery' }],
  ['bellows-the-studio', 'George Wesley Bellows - The Studio - 2010.81' + CB, 'Bellows The Studio Crystal Bridges', 1000, { title: 'The Studio', artist: 'George Wesley Bellows', year: '1919', room: 'early-twentieth' }],
  ['maurer-midinette', 'Alfred Maurer - The Midinette - 2010.45' + CB, 'Maurer Midinette Crystal Bridges', 1000, { title: 'The Midinette', artist: 'Alfred Henry Maurer', year: 'c. 1901', room: 'early-twentieth' }],
  ['luks-in-the-corner', 'George Benjamin Luks - In the Corner - 2014.34' + CB, 'Luks In the Corner Crystal Bridges', 1000, { title: 'In the Corner', artist: 'George Benjamin Luks', year: 'c. 1905', room: 'early-twentieth' }],
  ['decker-boy-berries', 'Joseph Decker - Boy Eating Berries - 2008.5' + CB, 'Decker Boy Eating Berries Crystal Bridges', 1000, { title: 'Boy Eating Berries', artist: 'Joseph Decker', year: '1886', room: 'corridor' }],
  ['peto-green-book', 'John Frederick Peto - Green Book and Lard Lamp - 2017.18' + CB, 'Peto Green Book Lard Lamp Crystal Bridges', 1000, { title: 'Green Book and Lard Lamp', artist: 'John Frederick Peto', year: 'c. 1890s', room: 'corridor' }],
  ['audubon-wild-turkey', 'John James Audubon - Wild Turkey Cock, Hen and Young - 2013.44' + CB, 'Audubon Wild Turkey Crystal Bridges', 1000, { title: 'Wild Turkey Cock, Hen and Young', artist: 'John James Audubon', year: '1826', room: 'corridor' }],
  ['tryon-brook-in-may', 'Dwight William Tryon - The Brook in May - 2010.107' + CB, 'Tryon Brook in May Crystal Bridges', 1000, { title: 'The Brook in May', artist: 'Dwight William Tryon', year: '1914', room: 'corridor' }],
  ['dewing-rose-garden', 'Maria Oakey Dewing - Rose Garden - 2006.67' + CB, 'Maria Oakey Dewing Rose Garden Crystal Bridges', 1000, { title: 'Rose Garden', artist: 'Maria Oakey Dewing', year: '1901', room: 'corridor' }],
];

const ALLOWED = new Set(['public domain', 'cc0', 'cc0 1.0', 'cc0 1.0 universal', 'cc by 1.0', 'cc by 2.0', 'cc by 2.5', 'cc by 3.0', 'cc by 4.0']);

/** The narrow musewalk policy: SA / NC variants and unknown licenses are rejected. */
export function licenseIsAllowed(shortName) {
  const n = String(shortName || '').replace(/ /g, ' ').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return ALLOWED.has(n);
}

/** Commons extmetadata values are HTML; keep plain text for labels (never rendered as HTML). */
export function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const qs = new URLSearchParams({ ...params, format: 'json' }).toString();
  for (const delay of [0, 3000, 8000, 20000]) {
    if (delay) await sleep(delay);
    try {
      const res = await fetch(API + '?' + qs, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt.trim()) return JSON.parse(txt);
    } catch {
      // retry with backoff (Commons returns empty bodies when rate-limiting)
    }
  }
  throw new Error('Commons API kept failing');
}

const meta = (ext, k) => {
  const f = ext && ext[k];
  return f && typeof f === 'object' && f.value != null ? String(f.value).trim() : '';
};

// Wikimedia's standard thumbnail steps (non-standard widths are rendered on demand and throttled)
const THUMB_STEPS = [960, 1280];
const snapWidth = (w) => (w >= 1200 ? THUMB_STEPS[1] : THUMB_STEPS[0]);

async function fileInfo(title, width) {
  width = snapWidth(width);
  const t = title.startsWith('File:') ? title : 'File:' + title;
  const data = await api({
    action: 'query', prop: 'imageinfo', redirects: 1, iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit', iiextmetadatalanguage: 'en', titles: t,
  });
  const pages = (data.query && data.query.pages) || {};
  for (const [pid, page] of Object.entries(pages)) {
    if (pid === '-1' || 'missing' in page || !page.imageinfo) return [null, 'missing Commons file'];
    const ii = page.imageinfo[0];
    if (ii.mime !== 'image/jpeg') return [null, `not a JPEG (${ii.mime || 'unknown'})`];
    const ext = ii.extmetadata || {};
    const lic = meta(ext, 'LicenseShortName');
    if (!licenseIsAllowed(lic)) return [null, `license rejected (${lic || 'unknown'})`];
    if (!ii.descriptionurl) return [null, 'missing canonical description URL'];
    const artist = plainText(meta(ext, 'Artist'));
    const credit = plainText(meta(ext, 'Credit'));
    const licenseUrl = meta(ext, 'LicenseUrl');
    if (lic.toLowerCase().startsWith('cc by') && (!(artist || credit) || !licenseUrl)) return [null, 'CC BY file lacks attribution metadata'];
    // Wikimedia asks automated clients for standard thumbnail steps only (mediawiki.org/wiki/Common_thumbnail_sizes)
    const small = false;
    const url = String(ii.thumburl || '').split('?')[0];
    if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url)) return [null, 'unexpected image host'];
    return [{
      commonsFileTitle: page.title || t, canonicalDescriptionUrl: ii.descriptionurl, licenseShortName: lic, licenseUrl,
      commonsArtist: artist, credit, sourceWidth: ii.width, sourceHeight: ii.height,
      width: small ? ii.width : ii.thumbwidth || ii.width, height: small ? ii.height : ii.thumbheight || ii.height, _url: url,
    }, null];
  }
  return [null, 'missing Commons file'];
}

async function search(q) {
  const data = await api({ action: 'query', list: 'search', srsearch: q, srnamespace: '6', srlimit: '12' });
  return ((data.query && data.query.search) || []).map((h) => h.title).filter((t) => /\.jpe?g$/i.test(t) && /crystal bridges/i.test(t));
}

async function selectSource([, exact, fallback, width], prev) {
  const rejected = [];
  const tried = new Set();
  const inspect = async (t, how) => {
    const k = t.toLowerCase();
    if (tried.has(k)) return null;
    tried.add(k);
    const [info, why] = await fileInfo(t, width);
    await sleep(PACE_MS);
    if (info) return [info, how];
    rejected.push(`${t}: ${why}`);
    return null;
  };
  for (const [t, how] of [[prev && prev.commonsFileTitle, 'manifest'], [exact, 'exact']]) {
    if (!t) continue;
    const ok = await inspect(t, how);
    if (ok) return [...ok, rejected];
  }
  for (const t of await search(fallback)) {
    const ok = await inspect(t, 'search');
    if (ok) return [...ok, rejected];
  }
  return [null, null, rejected];
}

async function download(url, dest) {
  let res = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
    if (res.status !== 429 && res.status !== 503) break;
    // rate-limited: honour Retry-After (seconds), capped at 15 minutes
    const ra = Math.min(900, Math.max(30, Number(res.headers.get('retry-after')) || 60));
    console.log(`  rate-limited, waiting ${ra}s`);
    await sleep(ra * 1000);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_FILE_BYTES || buf.length > MAX_FILE_BYTES) throw new Error(`unexpected size ${buf.length}`);
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new Error('download is not a JPEG');
  const tmp = dest + '.part';
  await writeFile(tmp, buf);
  await rename(tmp, dest);
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

async function localSummary(p) {
  if (!existsSync(p)) return null;
  const buf = await readFile(p);
  if (buf.length < MIN_FILE_BYTES || !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return null;
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

async function loadManifest() {
  if (!existsSync(MANIFEST)) return null;
  const m = JSON.parse(await readFile(MANIFEST, 'utf8'));
  if (m.schemaVersion !== 1 || !m.files || typeof m.files !== 'object') throw new Error('malformed manifest');
  return m;
}

async function writeManifest(m) {
  m.files = Object.fromEntries(Object.entries(m.files).sort(([a], [b]) => a.localeCompare(b)));
  const tmp = MANIFEST + '.part';
  await writeFile(tmp, JSON.stringify(m, null, 2) + '\n');
  await rename(tmp, MANIFEST);
}

/** public/art/catalog.json: title / artist / year / room for every listed work (labels work before images download). */
async function writeCatalog() {
  const works = Object.fromEntries(WORKS.map(([id, , , , info]) => [id, info]));
  const out = path.join(ROOT, 'public', 'art', 'catalog.json');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/fetch-cb-art.mjs', works }, null, 2) + '\n');
}

// ---------------------------------------------------------------- museum source (--source museum)
// The owner chose the museum's own collection images (crystalbridges.org/artworks/<accession>)
// when Commons rate-limited this machine. Same policy: a work is accepted only when the museum's
// own record says "copyright": "Public Domain"; the credit line and photography credit are kept,
// with "Courtesy of Crystal Bridges Museum of American Art".
const MUSEUM_PAGE = 'https://crystalbridges.org/artworks/';
const MUSEUM_IMG = /^https:\/\/dam\.aweoffice\.org\/AssetLink\/[a-z0-9]+\.jpg$/;

/** Accession number from the Commons file title ("... - 2010.106 - Crystal Bridges ..."), or null. */
export function accessionOf(commonsTitle) {
  const m = /-\s(\d{4}\.\d{1,4})\s-\sCrystal Bridges/.exec(commonsTitle);
  return m ? m[1] : null;
}

/** Pull the record fields out of a museum artwork page (JSON embedded in the Next.js payload). */
export function parseMuseumPage(html) {
  const field = (k) => {
    const m = new RegExp('\\\\?"' + k + '\\\\?":\\\\?"([^"\\\\]{0,300})').exec(html);
    return m ? m[1] : '';
  };
  const pre = /<link rel="preload" as="image" href="(https:\/\/dam\.aweoffice\.org\/AssetLink\/[a-z0-9]+\.jpg)"/.exec(html);
  return { copyright: field('copyright'), creditLine: field('creditLine'), photographyCredit: field('photographyCredit'), image: pre ? pre[1] : null };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function museumWork(work, manifest) {
  const [id, exact, , , info] = work;
  const acc = accessionOf(exact);
  const slug = info.museumSlug || (acc && acc.replace('.', '-'));
  if (!slug || !/^[a-z0-9-]{3,20}$/.test(slug)) return `no museum record for "${exact.slice(0, 60)}"`;
  const pageUrl = MUSEUM_PAGE + slug;
  const rec = parseMuseumPage(await fetchText(pageUrl));
  await sleep(1500);
  if (rec.copyright.toLowerCase() !== 'public domain') return `museum rights "${rec.copyright || 'unknown'}" (only Public Domain is accepted)`;
  if (!rec.image || !MUSEUM_IMG.test(rec.image)) return 'no image on the museum page';
  const key = id + '.jpg';
  const dest = path.join(OUT_DIR, key);
  const local = await download(rec.image, dest);
  await sleep(1500);
  const { default: sharp } = await import('sharp').catch(() => ({ default: null }));
  const meta = sharp ? await sharp(dest).metadata() : { width: 0, height: 0 };
  manifest.files[key] = {
    workId: id, localPath: `public/art/crystal-bridges/${key}`, url: `/art/crystal-bridges/${key}`,
    title: info.title, artist: info.artist, year: info.year, room: info.room,
    bytes: local.bytes, sha256: local.sha256, width: meta.width, height: meta.height,
    source: 'crystalbridges.org', canonicalDescriptionUrl: pageUrl, imageUrl: rec.image,
    licenseShortName: 'Public domain', museumRights: rec.copyright,
    credit: [rec.creditLine, rec.photographyCredit, 'Courtesy of Crystal Bridges Museum of American Art'].filter(Boolean).join('. '),
    collection: 'Crystal Bridges Museum of American Art',
  };
  await writeManifest(manifest);
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  await writeCatalog();
  if (args.includes('--catalog-only')) return;
  if (args.includes('--source') && args[args.indexOf('--source') + 1] === 'museum') return mainMuseum(args);
  const only = new Set();
  for (let i = 0; i < args.length; i++) if (args[i] === '--only') only.add(args[++i]);
  const metadataOnly = args.includes('--metadata-only');
  const unknown = [...only].filter((id) => !WORKS.some((w) => w[0] === id));
  if (unknown.length) throw new Error('unknown work id(s): ' + unknown.join(', '));
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = (await loadManifest()) || {
    schemaVersion: 1,
    generatedBy: 'scripts/fetch-cb-art.mjs (Node port of musewalk scripts/fetch_art.py, MIT)',
    licensePolicy: { accepted: ['Public domain', 'CC0', 'CC BY <version>'], rejected: ['CC BY-SA', 'CC BY-NC', 'unknown/missing'] },
    files: {},
  };
  let failures = 0;
  for (const work of WORKS) {
    const [id, , , , info] = work;
    if (only.size && !only.has(id)) continue;
    const key = id + '.jpg';
    const dest = path.join(OUT_DIR, key);
    const prev = manifest.files[key];
    try {
      let local = await localSummary(dest);
      if (metadataOnly && !local) {
        console.log(`[skip] ${id} no local JPEG`);
        continue;
      }
      const [src, how, rejected] = await selectSource(work, prev);
      if (!src) {
        failures++;
        console.log(`[FAIL] ${id} ${rejected.slice(0, 3).join('; ').slice(0, 240)}`);
        continue;
      }
      const reuse = local && ((how === 'manifest' && prev && prev.sha256 === local.sha256) || (how === 'exact' && !prev));
      if (!reuse) {
        if (metadataOnly) throw new Error('local file source is ambiguous; rerun without --metadata-only');
        local = await download(src._url, dest);
        await sleep(PACE_MS);
      }
      manifest.files[key] = {
        workId: id, localPath: `public/art/crystal-bridges/${key}`, url: `/art/crystal-bridges/${key}`,
        title: info.title, artist: info.artist, year: info.year, room: info.room,
        bytes: local.bytes, sha256: local.sha256, width: src.width, height: src.height,
        commonsFileTitle: src.commonsFileTitle, canonicalDescriptionUrl: src.canonicalDescriptionUrl,
        licenseShortName: src.licenseShortName, licenseUrl: src.licenseUrl, commonsArtist: src.commonsArtist, credit: src.credit,
        collection: 'Crystal Bridges Museum of American Art',
      };
      await writeManifest(manifest);
      console.log(`[${reuse ? 'meta' : 'ok'}] ${id} ${src.licenseShortName} ${Math.round(local.bytes / 1024)}KB <- ${src.commonsFileTitle}`);
    } catch (e) {
      failures++;
      console.log(`[FAIL] ${id} ${String(e.message || e).slice(0, 200)}`);
    }
  }
  console.log(`done. failures=${failures} entries=${Object.keys(manifest.files).length}`);
  process.exitCode = failures ? 1 : 0;
}

async function mainMuseum(args) {
  const only = new Set();
  for (let i = 0; i < args.length; i++) if (args[i] === '--only') only.add(args[++i]);
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = (await loadManifest()) || { schemaVersion: 1, generatedBy: 'scripts/fetch-cb-art.mjs', files: {} };
  manifest.licensePolicy = {
    accepted: ['Public domain', 'CC0', 'CC BY <version>'],
    rejected: ['CC BY-SA', 'CC BY-NC', 'unknown/missing'],
    museumSource: 'crystalbridges.org records whose "copyright" is "Public Domain" only',
  };
  let failures = 0;
  for (const work of WORKS) {
    const id = work[0];
    if (only.size && !only.has(id)) continue;
    if (manifest.files[id + '.jpg'] && existsSync(path.join(OUT_DIR, id + '.jpg'))) {
      console.log(`[have] ${id}`);
      continue;
    }
    try {
      const why = await museumWork(work, manifest);
      if (why) {
        failures++;
        console.log(`[skip] ${id} ${why}`);
      } else console.log(`[ok] ${id} <- crystalbridges.org`);
    } catch (e) {
      failures++;
      console.log(`[FAIL] ${id} ${String(e.message || e).slice(0, 160)}`);
    }
  }
  console.log(`done. not fetched=${failures} entries=${Object.keys(manifest.files).length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  });
}
