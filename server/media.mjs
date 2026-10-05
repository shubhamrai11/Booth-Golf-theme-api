import sharp from 'sharp';

export async function normalizeImage(buffer, { maxEdge = 2048 } = {}) {
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const meta = await sharp(buffer, { limitInputPixels: 50000000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('Use a JPEG, PNG or WebP image. RAW camera files are not supported; set the camera to JPEG.');
  return sharp(buffer, { limitInputPixels: 50000000 }).rotate().resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
}

export async function normalizeOverlay(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 50000000 }).metadata();
  if (meta.format !== 'png' || !meta.hasAlpha) throw new Error('The branding overlay must be a PNG with transparency.');
  return sharp(buffer).resize(1200, 1800, { fit: 'fill' }).png().toBuffer();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export async function composePortrait(buffer, config, overlayBuffer) {
  const width = 1200, height = 1800;
  const image = config.frameEnabled
    ? await sharp(buffer).resize(1120, 1536, { fit: 'contain', background: config.frameColor }).png().toBuffer()
    : await sharp(buffer).resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  const layers = [{ input: image, top: config.frameEnabled ? 40 : 0, left: config.frameEnabled ? 40 : 0 }];
  if (config.frameEnabled) layers.push({ input: Buffer.from(`<svg width="1200" height="1800"><rect x="515" y="1600" width="170" height="40" rx="4" fill="none" stroke="white"/><text x="600" y="1627" text-anchor="middle" font-family="Arial" font-size="19" fill="white" letter-spacing="2">YOUR LOGO</text><text x="600" y="1701" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" fill="white" letter-spacing="2">${esc(config.footerTitle)}</text><text x="600" y="1748" text-anchor="middle" font-family="Arial, sans-serif" font-size="23" fill="white" letter-spacing="2">${esc(config.footerSubtitle)}</text></svg>`) });
  if (overlayBuffer) layers.push({ input: overlayBuffer });
  layers.push({ input: Buffer.from(`<svg width="1200" height="1800"><rect x="880" y="1510" width="256" height="43" rx="8" fill="white" opacity=".90"/><text x="1008" y="1539" text-anchor="middle" font-family="Arial" font-size="21" fill="#173c30">${config.mode === 'rehearsal' ? 'REHEARSAL · NO AI' : 'AI MODIFIED'}</text></svg>`) });
  return sharp({ create: { width, height, channels: 3, background: config.frameEnabled ? config.frameColor : '#ffffff' } }).composite(layers).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer();
}
