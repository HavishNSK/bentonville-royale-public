// Shared Playwright launch + diagnostics for the QA tools (playtest.mjs, mp.mjs).
//
// Patterns adapted (ideas, not code) from:
//   - jbcom/game-harness (MIT) https://github.com/jbcom/game-harness
//       silent sessions (--mute-audio) and "fail on page errors / console errors / failed requests"
//   - tools/qa/smoke.mjs (this repo) for the GPU flag fallback ladder
import { chromium } from 'playwright';

const COMMON_FLAGS = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'];
const GPU_FLAG_SETS = [['--use-angle=metal'], ['--use-gl=angle', '--use-angle=swiftshader'], ['--enable-unsafe-swiftshader']];

function probeWebGL() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { ok: false, renderer: null };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { ok: !gl.isContextLost(), renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) };
}

/** First Chromium flag set that yields a WebGL2 context: { browser, flags, renderer } or null. */
export async function launchWithWebGL({ headless = true } = {}) {
  for (const flags of GPU_FLAG_SETS) {
    let browser;
    try {
      browser = await chromium.launch({ headless, args: [...flags, ...COMMON_FLAGS] });
      const page = await browser.newPage();
      await page.goto('about:blank');
      const r = await page.evaluate(probeWebGL);
      await page.close();
      if (r.ok) return { browser, flags, renderer: r.renderer };
    } catch {
      // try the next flag set; the caller reports a null result
    }
    if (browser) await browser.close().catch(() => {});
  }
  return null;
}

/** Collect page errors, console errors/warnings and failed requests into `sink`. */
export function attachDiagnostics(page, sink, tag = '') {
  const t = tag ? `[${tag}] ` : '';
  page.on('pageerror', (e) => sink.pageErrors.push(t + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
  page.on('console', (m) => {
    if (m.type() === 'error') sink.consoleErrors.push(t + m.text().slice(0, 400));
    else if (m.type() === 'warning') sink.consoleWarnings.push(t + m.text().slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    const f = r.failure();
    // aborted media / beacon requests on navigation are noise
    if (f && /ERR_ABORTED/.test(f.errorText)) return;
    sink.failedRequests.push(`${t}${r.method()} ${r.url()} ${f ? f.errorText : ''}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) sink.failedRequests.push(`${t}HTTP ${r.status()} ${r.url()}`);
  });
}

export const newSink = () => ({ pageErrors: [], consoleErrors: [], consoleWarnings: [], failedRequests: [] });

/** Chromebook-ish profile: CPU throttle via CDP (1 = off). */
export async function throttleCpu(page, rate) {
  if (!rate || rate <= 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** Seed localStorage before the app boots (settings, player name). */
export async function seedStorage(context, entries) {
  await context.addInitScript((e) => {
    try {
      for (const [k, v] of Object.entries(e)) if (localStorage.getItem(k) == null) localStorage.setItem(k, v);
    } catch {
      // storage blocked: the game must still boot with defaults
    }
  }, entries);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
