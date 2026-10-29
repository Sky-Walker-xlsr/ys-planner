// Einmalig: App-Icons aus public/brand/*.svg erzeugen (Ergebnis wird committet).
//   node scripts/generate-icons.mjs
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import opentype from 'opentype.js'

const root = join(import.meta.dirname, '..')
const brand = (f) => join(root, 'public', 'brand', f)
const logo = readFileSync(brand('logo.svg'), 'utf8')
const logoSmall = readFileSync(brand('logo-small.svg'), 'utf8')

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * Math.ceil(size / 96) * 4 }).resize(size, size).png().toBuffer()
// Bis 32 px die Klein-Variante (ohne Punkte)
const iconSvg = (size) => (size <= 32 ? logoSmall : logo)

/** ICO-Container mit PNG-Einträgen */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4) // Farbebenen
    e.writeUInt16LE(32, 6) // Bit pro Pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

// app/icon.svg = logo-small.svg
copyFileSync(brand('logo-small.svg'), join(root, 'app', 'icon.svg'))

// app/favicon.ico (16, 32, 48)
const favicon = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(iconSvg(size), size) })))
writeFileSync(join(root, 'app', 'favicon.ico'), ico(favicon))

// app/apple-icon.png: 180×180, ohne Rundung (iOS rundet selbst), Hintergrund vollflächig
writeFileSync(join(root, 'app', 'apple-icon.png'), await png(logo.replace('rx="22"', 'rx="0"'), 180))

// PWA-Icons
writeFileSync(brand('icon-192.png'), await png(logo, 192))
writeFileSync(brand('icon-512.png'), await png(logo, 512))

// Maskable: Hintergrund vollflächig, Motiv auf 80 % skaliert und zentriert (Safe Zone)
const motif = logo.replace(/<rect[^>]*\/>/, '').replace(/<\/?svg[^>]*>/g, '')
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" fill="#1F7A57"/>
  <g transform="translate(48 48) scale(0.8) translate(-48 -48)">${motif}</g>
</svg>`
writeFileSync(brand('icon-maskable-512.png'), await png(maskable, 512))

// OG-Image 1200×630: Hintergrund #F5F6F8, Logo 160 px, Wortmarke 64 px (Inter 700, −0.01em), zentriert
const font = opentype.parse(readFileSync(join(root, 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-700-normal.woff')).buffer)
const W = 1200
const H = 630
const LOGO = 160
const TEXT = 64
const GAP = 40
// Glyphen einzeln setzen (Kerning + Laufweite −0.01em); die Shaping-Engine von opentype.js kann Inter nicht vollständig
function textPath(str, x, y, size) {
  const scale = size / font.unitsPerEm
  const glyphs = [...str].map((c) => font.charToGlyph(c))
  const path = new opentype.Path()
  let cx = x
  glyphs.forEach((g, i) => {
    path.extend(g.getPath(cx, y, size))
    cx += g.advanceWidth * scale
    if (i < glyphs.length - 1) cx += font.getKerningValue(g, glyphs[i + 1]) * scale - 0.01 * size
  })
  return { path, width: cx - x }
}
const probe = textPath('ys-planner', 0, 0, TEXT)
const box = probe.path.getBoundingBox()
const textHeight = box.y2 - box.y1
const top = Math.round((H - (LOGO + GAP + textHeight)) / 2)
const baseline = top + LOGO + GAP - box.y1
const text = textPath('ys-planner', (W - probe.width) / 2, baseline, TEXT).path.toPathData(2)
const logoInner = logo.replace(/<\/?svg[^>]*>/g, '')
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#F5F6F8"/>
  <g transform="translate(${(W - LOGO) / 2} ${top}) scale(${LOGO / 96})">${logoInner}</g>
  <path d="${text}" fill="#1B1D21"/>
</svg>`
writeFileSync(brand('og-image.png'), await sharp(Buffer.from(og)).png().toBuffer())

console.log('Icons erzeugt: app/icon.svg, app/favicon.ico, app/apple-icon.png, public/brand/icon-192.png, icon-512.png, icon-maskable-512.png, og-image.png')
