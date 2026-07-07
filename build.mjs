// Bundle Lory's Lab:
//  - dist/lorys-lab.html  — standalone single-file build (open directly in a browser)
//  - dist/artifact.html   — body-content-only variant for claude.ai Artifact hosting
//    (the artifact host wraps content in its own <!doctype>…<head>…<body> skeleton)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const html = readFileSync('index.html', 'utf8');
const scripts = ['vendor/matter.min.js', 'src/core.js', 'src/levels.js', 'src/audio.js', 'src/render.js', 'src/game.js'];

const inlined = scripts.map(p => `<script>\n/* ==== ${p} ==== */\n${readFileSync(p, 'utf8')}\n</script>`).join('\n');

// standalone — strip PWA link tags (manifest/icons live on the hosted site,
// not next to the single file; leaving them logs 404s on file://)
let standalone = html.replace(/^\s*<script src="[^"]+"><\/script>\s*$/gm, '');
standalone = standalone.replace(/^\s*<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\s*$/gm, '');
standalone = standalone.replace('</body>', inlined + '\n</body>');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/lorys-lab.html', standalone);
console.log('dist/lorys-lab.html:', (standalone.length / 1024).toFixed(0), 'KB');

// artifact variant: <title> + <style> + app div + scripts, no document skeleton
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const artifactStyle = style
  .replace('html, body { height: 100%; overflow: hidden; background: #E9D9BE; }',
`:root { --lab-backdrop: #E9D9BE; }
  @media (prefers-color-scheme: dark) { :root { --lab-backdrop: #332B22; } }
  :root[data-theme="light"] { --lab-backdrop: #E9D9BE; }
  :root[data-theme="dark"] { --lab-backdrop: #332B22; }
  html, body { height: 100%; overflow: hidden; background: var(--lab-backdrop); }`);
const artifact = `<title>Lory's Lab</title>
<style>${artifactStyle}</style>
<div id="app">
  <canvas id="game"></canvas>
</div>
${inlined}
`;
writeFileSync('dist/artifact.html', artifact);
writeFileSync('dist/lorys-lab-game.html', artifact); // old artifact path (kept for safety)
writeFileSync('dist/lorys-lab-play.html', artifact); // current published artifact path
console.log('dist/artifact.html:', (artifact.length / 1024).toFixed(0), 'KB');
