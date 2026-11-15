// Regenerates the PNG icons and the default social share image. Run: node scripts/make-icons.mjs
import sharp from 'sharp';

const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" fill="#17161a"/>
  <text x="32" y="47" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="44" fill="#f7f5f0">S</text>
</svg>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f7f5f0"/>
  <text x="80" y="130" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="600" letter-spacing="4" fill="#6f6d74">A MOVIE REVIEW &amp; DISCUSSION PODCAST</text>
  <text x="72" y="330" font-family="Georgia, serif" font-size="190" fill="#17161a">Sink <tspan font-style="italic">Alike</tspan></text>
  <text x="80" y="440" font-family="Georgia, serif" font-size="44" fill="#55535a">We may not think alike, but we can always sink alike.</text>
  <circle cx="92" cy="535" r="14" fill="#c24e29"/><text x="118" y="545" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#17161a">Adam Estock</text>
  <circle cx="330" cy="535" r="14" fill="#26716f"/><text x="356" y="545" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#17161a">William Gill</text>
  <circle cx="568" cy="535" r="14" fill="#8a6100"/><text x="594" y="545" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#17161a">Ty Wilkinson</text>
</svg>`;

await sharp(Buffer.from(icon(180))).png().toFile('public/icon-180.png');
await sharp(Buffer.from(icon(512))).png().toFile('public/icon-512.png');
await sharp(Buffer.from(og)).png().toFile('public/og.png');
console.log('Wrote public/icon-180.png, public/icon-512.png, public/og.png');
