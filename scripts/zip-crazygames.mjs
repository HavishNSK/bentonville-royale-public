// Zips dist-crazygames/ into bentonville-royale-crazygames.zip for upload at
// developer.crazygames.com (run by `npm run build:crazygames`). Needs the `zip` command
// (macOS / Linux); elsewhere, zip the dist-crazygames folder's contents by hand.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist-crazygames';
const OUT = 'bentonville-royale-crazygames.zip';
if (!existsSync(join(DIR, 'index.html'))) {
  console.error(`${DIR}/index.html missing: run the build first`);
  process.exit(1);
}
let files = 0;
let bytes = 0;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      files++;
      bytes += st.size;
    }
  }
})(DIR);
rmSync(OUT, { force: true });
const r = spawnSync('zip', ['-rq', join('..', OUT), '.'], { cwd: DIR, stdio: 'inherit' });
if (r.error || r.status !== 0) {
  console.error('zip failed or is not installed: zip the contents of', DIR, 'yourself');
  process.exit(1);
}
const mb = (bytes / 1048576).toFixed(1);
console.log(`${OUT}: ${files} files, ${mb} MB unpacked (CrazyGames limits: 1500 files, 250 MB total, 50 MB initial download)`);
