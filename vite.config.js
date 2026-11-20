import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Personal music lives in ./local-music (git-ignored). It is served only by the
// local dev and preview servers and is never copied into the build, so it never
// reaches a deploy.
const LOCAL_MUSIC_DIR = path.resolve('local-music');

function localMusic() {
  const handler = (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/local-music/')) return next();
    const name = path.basename(decodeURIComponent(url));
    const file = path.join(LOCAL_MUSIC_DIR, name);
    if (!name.endsWith('.mp3') || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    const stat = fs.statSync(file);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? parseInt(range[2], 10) : stat.size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', stat.size);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: 'local-music',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

// AdSense publisher id for the website (public by design: it is in every ad tag). An env
// VITE_ADSENSE_CLIENT overrides it; the CrazyGames portal build never uses AdSense.
const DEFAULT_ADSENSE_CLIENT = 'ca-pub-5854166867877139';

/**
 * The AdSense tag in <head> (site verification + Auto ads need it in the page itself), website
 * builds only. public/ads-init.js runs first so the kid-safe flags are set before the tag
 * reads them; src/net/Ads.js sees this tag and does not load a second copy.
 */
function adsenseTag(env) {
  return {
    name: 'adsense-tag',
    apply: 'build',
    transformIndexHtml() {
      const client = String(env.VITE_ADSENSE_CLIENT || '');
      if (!/^ca-pub-\d+$/.test(client) || env.VITE_PLATFORM === 'crazygames') return [];
      return [
        { tag: 'script', attrs: { src: '/ads-init.js' }, injectTo: 'head' },
        {
          tag: 'script',
          attrs: {
            async: true,
            src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
            crossorigin: 'anonymous',
            'data-tag-for-age-treatment': '1',
          },
          injectTo: 'head',
        },
      ];
    },
  };
}

// AdSense: ads.txt at the site root lists who may sell ads on it. Emitted only when the build
// has a real publisher id (VITE_ADSENSE_CLIENT=ca-pub-1234...), never with a placeholder, and
// never in the CrazyGames portal build (CrazyGames runs its own ads).
function adsTxt(env) {
  return {
    name: 'ads-txt',
    generateBundle() {
      const client = String(env.VITE_ADSENSE_CLIENT || '');
      const m = /^ca-(pub-\d+)$/.exec(client);
      if (!m || env.VITE_PLATFORM === 'crazygames') return;
      this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${m[1]}, DIRECT, f08c47fec0942fa0\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env / .env.local VITE_* values plus the shell's (the shell wins, like Vite itself)
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  if (!env.VITE_ADSENSE_CLIENT && env.VITE_PLATFORM !== 'crazygames') env.VITE_ADSENSE_CLIENT = DEFAULT_ADSENSE_CLIENT;
  const adsClient = env.VITE_PLATFORM === 'crazygames' ? '' : String(env.VITE_ADSENSE_CLIENT || '');
  return {
    plugins: [localMusic(), adsTxt(env), adsenseTag(env)],
    define: { 'import.meta.env.VITE_ADSENSE_CLIENT': JSON.stringify(adsClient) },
    server: { port: 5173, host: true },
    build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  };
});
