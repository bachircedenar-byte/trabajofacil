/* Generador de assets SVG de TrabajoFácil.
   Ejecutar:  node herramientas/generar-assets.mjs
   Produce gráficos vectoriales propios: marca, mosaico del hero, tiles de
   servicio, avatares, mapa y textura del banner. Sin imágenes de terceros. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const img = join(raiz, 'assets', 'img');
mkdirSync(img, { recursive: true });

const escribir = (nombre, svg) => {
  writeFileSync(join(img, nombre), svg.trim(), 'utf8');
  console.log('  ·', nombre);
};

/* ---------- paleta ---------- */
const VERDE = '#2ea378';
const TINTA = '#101c19';
const TONOS = ['#00acb5', '#ff8a4c', '#307cf0', '#7c5ce6', '#e65696', '#f0aa28', '#16a06e', '#5a78aa'];

/* ---------- 1. marca ---------- */
escribir('marca.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="TrabajoFácil">
  <rect width="64" height="64" rx="16" fill="${VERDE}"/>
  <path d="M18 33.5 L28 43.5 L46 21" fill="none" stroke="#fff" stroke-width="7"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

/* ---------- 2. lupa (buscador) ---------- */
escribir('lupa.svg', `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <circle cx="10.5" cy="10.5" r="6.6" fill="none" stroke="#8b8b8b" stroke-width="2.2"/>
  <path d="M15.4 15.4 L21 21" stroke="#8b8b8b" stroke-width="2.4" stroke-linecap="round"/>
</svg>`);

/* ---------- 3. mosaico del hero (3x3) ---------- */
const formas = [
  '<circle cx="120" cy="90" r="62" fill="#fff" opacity=".16"/>',
  '<rect x="30" y="120" width="150" height="26" rx="13" fill="#fff" opacity=".13"/>',
  '<path d="M20 190 L90 70 L160 190 Z" fill="#fff" opacity=".15"/>',
  '<circle cx="150" cy="60" r="46" fill="#fff" opacity=".12"/>',
  '<rect x="40" y="40" width="70" height="70" rx="18" fill="#fff" opacity=".14"/>',
  '<path d="M40 180 Q120 60 200 180 Z" fill="#fff" opacity=".16"/>',
  '<circle cx="70" cy="70" r="34" fill="#fff" opacity=".12"/>',
  '<rect x="110" y="30" width="26" height="160" rx="13" fill="#fff" opacity=".12"/>',
  '<circle cx="130" cy="120" r="70" fill="#fff" opacity=".1"/>'
];
let hero = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice">
<defs>`;
TONOS.forEach((c, i) => {
  hero += `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c}" stop-opacity="1"/><stop offset="1" stop-color="${TINTA}" stop-opacity=".45"/>
  </linearGradient>`;
});
hero += `</defs><rect width="600" height="600" fill="${TINTA}"/>`;
for (let f = 0; f < 9; f++) {
  const x = (f % 3) * 200, y = Math.floor(f / 3) * 200;
  hero += `<g transform="translate(${x},${y})">
    <rect width="200" height="200" fill="url(#g${f % TONOS.length})"/>${formas[f]}</g>`;
}
hero += `</svg>`;
escribir('hero.svg', hero);

/* ---------- 4. textura del banner CTA ---------- */
let banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice">
<rect width="1200" height="420" fill="${TINTA}"/>`;
for (let i = 0; i < 26; i++) {
  const x = (i * 137) % 1200, y = (i * 271) % 420, r = 40 + ((i * 37) % 110);
  banner += `<circle cx="${x}" cy="${y}" r="${r}" fill="${TONOS[i % TONOS.length]}" opacity=".18"/>`;
}
banner += `</svg>`;
escribir('banner-cta.svg', banner);

/* ---------- 5. tiles de servicio ---------- */
const areas = [
  ['area-limpieza', '#00acb5'], ['area-reparaciones', '#ff8a4c'], ['area-mudanzas', '#307cf0'],
  ['area-informatica', '#7c5ce6'], ['area-mascotas', '#e65696'], ['area-eventos', '#f0aa28'],
  ['area-oficinas', '#5a78aa'], ['area-deporte', '#16a06e'], ['area-educacion', '#8a6fd0'],
  ['area-urgencia', '#e05a4c'], ['area-personas', '#c96a9e'], ['area-destacados', '#2ea378']
];
const iconos = [
  // simplicity: broom / spray
  '<path d="M150 330 L250 150" stroke="#fff" stroke-width="16" stroke-linecap="round"/><rect x="120" y="330" width="120" height="34" rx="17" fill="#fff"/>',
  // hammer
  '<rect x="180" y="250" width="40" height="120" rx="18" fill="#fff"/><rect x="140" y="210" width="120" height="42" rx="21" fill="#fff"/>',
  // box
  '<rect x="130" y="250" width="140" height="120" rx="14" fill="#fff"/><rect x="130" y="250" width="140" height="30" rx="14" fill="#fff" opacity=".65"/>',
  // monitor
  '<rect x="120" y="220" width="160" height="110" rx="14" fill="#fff"/><rect x="180" y="330" width="40" height="40" fill="#fff"/>',
  // paw
  '<circle cx="160" cy="250" r="26" fill="#fff"/><circle cx="215" cy="240" r="22" fill="#fff"/><circle cx="258" cy="258" r="20" fill="#fff"/><ellipse cx="200" cy="305" rx="58" ry="44" fill="#fff"/>',
  // music
  '<circle cx="160" cy="300" r="42" fill="#fff"/><circle cx="262" cy="278" r="42" fill="#fff"/><rect x="192" y="200" width="14" height="105" fill="#fff"/><rect x="294" y="178" width="14" height="105" fill="#fff"/>',
  // office
  '<rect x="130" y="250" width="150" height="120" rx="12" fill="#fff"/><rect x="160" y="200" width="90" height="50" rx="10" fill="#fff" opacity=".7"/>',
  // dumbbell
  '<rect x="120" y="278" width="180" height="28" rx="14" fill="#fff"/><rect x="100" y="250" width="34" height="84" rx="14" fill="#fff"/><rect x="286" y="250" width="34" height="84" rx="14" fill="#fff"/>',
  // book
  '<path d="M130 340 L130 220 L200 240 L200 350 Z" fill="#fff"/><path d="M270 340 L270 220 L200 240 L200 350 Z" fill="#fff" opacity=".7"/>',
  // clock
  '<circle cx="200" cy="290" r="70" fill="#fff"/><path d="M200 245 L200 292 L232 310" stroke="#2b3a35" stroke-width="12" stroke-linecap="round" fill="none"/>',
  // heart hands
  '<path d="M200 350 C120 300 120 240 160 240 C185 240 200 262 200 262 C200 262 215 240 240 240 C280 240 280 300 200 350 Z" fill="#fff"/>',
  // star
  '<path d="M200 215 L226 278 L294 282 L241 326 L258 392 L200 356 L142 392 L159 326 L106 282 L174 278 Z" fill="#fff"/>'
];
areas.forEach(([nombre, color], i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="a${i}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${TINTA}" stop-opacity=".92"/>
  </linearGradient></defs>
  <rect width="400" height="300" fill="url(#a${i})"/>
  <g opacity=".92">${iconos[i]}</g>
</svg>`;
  escribir(`${nombre}.svg`, svg);
});

/* ---------- 6. avatares ---------- */
const avatares = [
  ['avatar-1', 'NS', '#00acb5'], ['avatar-2', 'RI', '#ff8a4c'], ['avatar-3', 'MV', '#7c5ce6'],
  ['avatar-4', 'CL', '#e65696'], ['avatar-5', 'AP', '#307cf0'], ['avatar-6', 'SM', '#f0aa28'],
  ['avatar-7', 'DR', '#16a06e'], ['avatar-8', 'LF', '#c96a9e']
];
avatares.forEach(([nombre, ini, color]) => {
  escribir(`${nombre}.svg`, `
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs><linearGradient id="v" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${TINTA}" stop-opacity=".85"/>
  </linearGradient></defs>
  <rect width="160" height="160" fill="url(#v)"/>
  <circle cx="80" cy="62" r="28" fill="#fff" opacity=".9"/>
  <path d="M20 160 C20 118 46 100 80 100 C114 100 140 118 140 160 Z" fill="#fff" opacity=".9"/>
  <text x="80" y="152" text-anchor="middle" font-family="Montserrat,Segoe UI,Arial,sans-serif"
        font-size="22" font-weight="700" fill="${TINTA}" opacity=".75">${ini}</text>
</svg>`);
});

/* ---------- 7. mapa ---------- */
let mapa = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
<rect width="800" height="450" fill="#eef3f1"/>
<path d="M0 300 L180 250 L360 320 L560 240 L800 300 L800 450 L0 450 Z" fill="#dfeae6"/>
<path d="M0 120 L200 80 L420 140 L640 70 L800 110" stroke="#cddfd9" stroke-width="14" fill="none"/>
<path d="M120 0 L160 450" stroke="#cddfd9" stroke-width="12" fill="none"/>
<path d="M480 0 L460 450" stroke="#cddfd9" stroke-width="12" fill="none"/>
<path d="M700 0 L660 450" stroke="#cddfd9" stroke-width="10" fill="none"/>`;
const puntos = [[120,150],[230,210],[300,120],[380,260],[450,180],[520,300],[600,140],[680,230],[740,320],[200,330],[350,360],[90,380],[560,60],[80,220]];
puntos.forEach(([x, y], i) => {
  const r = 5 + (i % 4) * 2;
  mapa += `<circle cx="${x}" cy="${y}" r="${r + 8}" fill="${VERDE}" opacity=".16"/><circle cx="${x}" cy="${y}" r="${r}" fill="${VERDE}"/>`;
});
mapa += `<text x="24" y="36" font-family="Montserrat,Segoe UI,Arial,sans-serif" font-size="18" font-weight="700" fill="#5c6b66">Personas disponibles cerca de ti</text></svg>`;
escribir('mapa.svg', mapa);

console.log('\nAssets generados en', img);
