// Records the in-game trailer (real gameplay, deterministic) to phoenix_trailer.mp4 (1080x1920, 60fps).
// Usage: npm install && node record.mjs   (needs ffmpeg on PATH and Google Chrome)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const run = (args, opts) => new Promise((ok, no) => { const p = spawn('ffmpeg', args, opts); p.on('exit', c => c ? no(new Error('ffmpeg ' + c)) : ok()); return p; });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--hide-scrollbars'], defaultViewport: { width: 1080, height: 1920 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?trailer=rec');
await page.waitForFunction('window.TRAILER_READY');
await page.evaluate('document.fonts.ready');
const total = await page.evaluate('trailerTotalFrames()'), fps = await page.evaluate('trailerFps()');

const video = path.join(dir, 'trailer_video.mp4');
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', video], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((ok, no) => ff.on('exit', c => c ? no(new Error('ffmpeg ' + c)) : ok()));
for (let f = 0; f < total; f++) {
  await page.evaluate('trailerFrame()');
  const img = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 60 === 0) process.stdout.write(`\rframe ${f}/${total}`);
}
ff.stdin.end(); await done;
console.log('\nrendering audio…');
const wav = path.join(dir, 'trailer_audio.wav');
writeFileSync(wav, Buffer.from(await page.evaluate('renderTrailerAudio()'), 'base64'));
await browser.close();

await run(['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(dir, 'phoenix_trailer.mp4')], { stdio: 'inherit' });
console.log('wrote phoenix_trailer.mp4');
