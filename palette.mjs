#!/usr/bin/env node
// palette.mjs — dev tool: hue-based color editor for style.yaml
// Usage: node palette.mjs  (opens browser automatically)

import yaml from 'js-yaml';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLE_PATH = path.join(__dirname, 'style.yaml');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hslToRgb(hue, saturation, lightness) {
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(h % 2 - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h >= 0 && h < 1) {
    red = c;
    green = x;
  } else if (h < 2) {
    red = x;
    green = c;
  } else if (h < 3) {
    green = c;
    blue = x;
  } else if (h < 4) {
    green = x;
    blue = c;
  } else if (h < 5) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  const match = l - c / 2;
  return {
    red: Math.round((red + match) * 255),
    green: Math.round((green + match) * 255),
    blue: Math.round((blue + match) * 255),
  };
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function rgba({ red, green, blue }, alpha) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hexHue(hex) {
  const match = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return 12;
  }

  const value = match[1];
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0) {
    return 12;
  }

  let hue;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return Math.round(((hue * 60) + 360) % 360);
}

function getInitialHue(style) {
  if (typeof style.web?.theme_hue === 'number') {
    return style.web.theme_hue;
  }
  if (typeof style.web?.light?.accent === 'string') {
    return hexHue(style.web.light.accent);
  }
  return typeof style.colors?.accent === 'string' ? hexHue(style.colors.accent) : 12;
}

function generatePalette(hue) {
  const accentLight = hslToRgb(hue, 54, 36);
  const accentDark = hslToRgb(hue, 100, 77);
  const mutedLight = hslToRgb(hue, 11, 53);
  const mutedDark = hslToRgb(hue, 39, 64);

  return {
    light: {
      bg_top: rgbToHex(hslToRgb(hue, 65, 98)),
      bg_bottom: rgbToHex(hslToRgb(hue, 28, 92)),
      surface: rgba(hslToRgb(hue, 20, 100), 0.92),
      surface_strong: rgba(hslToRgb(hue, 27, 95), 0.55),
      border_soft: rgba(accentLight, 0.12),
      border_strong: rgba(accentLight, 0.16),
      shadow: rgba(hslToRgb(hue, 28, 17), 0.12),
      card_alt: 'white',
      hero_glow: rgba(accentLight, 0.18),
      primary: rgbToHex(hslToRgb(hue, 8, 10)),
      secondary: rgbToHex(hslToRgb(hue, 9, 29)),
      accent: rgbToHex(accentLight),
      light: rgbToHex(hslToRgb(hue, 28, 94)),
      muted: rgbToHex(mutedLight),
    },
    dark: {
      bg_top: rgbToHex(hslToRgb(hue, 27, 10)),
      bg_bottom: rgbToHex(hslToRgb(hue, 28, 5)),
      surface: rgba(hslToRgb(hue, 24, 10), 0.94),
      surface_strong: rgba(hslToRgb(hue, 23, 16), 0.84),
      border_soft: rgba(accentDark, 0.18),
      border_strong: rgba(accentDark, 0.24),
      shadow: 'rgba(0, 0, 0, 0.35)',
      card_alt: rgba(hslToRgb(hue, 22, 7), 0.95),
      hero_glow: rgba(accentDark, 0.18),
      primary: rgbToHex(hslToRgb(hue, 31, 93)),
      secondary: rgbToHex(hslToRgb(hue, 28, 77)),
      accent: rgbToHex(accentDark),
      light: rgba(accentDark, 0.1),
      muted: rgbToHex(mutedDark),
    },
  };
}

function buildPage(style) {
  const hue = getInitialHue(style);
  const generated = generatePalette(hue);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Palette editor — recipe2</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 32px 40px; background: #f5f5f5; color: #1a1a1a; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; font-weight: 600; }
  p.hint { margin: 0 0 24px; color: #555; font-size: 0.9rem; max-width: 56rem; }
  .panel { background: white; border-radius: 16px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .slider-row { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
  .slider-group { display: grid; gap: 8px; }
  label { font-size: 0.95rem; font-weight: 600; color: #333; }
  input[type=range] { width: 100%; }
  .hue-chip { width: 64px; height: 64px; border-radius: 16px; border: 1px solid rgba(0,0,0,0.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35); }
  .value-row { display: flex; gap: 12px; align-items: center; color: #555; font-size: 0.9rem; }
  .preview-grid { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .preview-card { border-radius: 18px; overflow: hidden; border: 1px solid rgba(0,0,0,0.08); }
  .preview-hero { padding: 20px; }
  .preview-hero h2 { margin: 0 0 8px; font-size: 1.2rem; font-weight: 600; }
  .preview-hero p { margin: 0; }
  .preview-body { padding: 20px; display: grid; gap: 12px; }
  .preview-item { border-radius: 12px; padding: 12px 14px; }
  .token-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
  .token { border-radius: 12px; overflow: hidden; border: 1px solid rgba(0,0,0,0.08); background: white; }
  .token-swatch { height: 38px; }
  .token-label { padding: 8px 10px; font-size: 0.82rem; color: #555; }
  .actions { margin-top: 24px; display: flex; gap: 12px; align-items: center; }
  button { padding: 10px 22px; border: none; border-radius: 8px; font: inherit; font-size: 0.95rem; cursor: pointer; background: #2563eb; color: white; }
  button:hover { background: #1d4ed8; }
  #status { font-size: 0.9rem; color: #16a34a; font-weight: 500; }
  #status.error { color: #dc2626; }
  @media (max-width: 720px) {
    .slider-row, .preview-grid, .token-row { grid-template-columns: 1fr; }
    .hue-chip { width: 100%; height: 44px; }
  }
</style>
</head>
<body>
<h1>Palette editor</h1>
<p class="hint">Use one hue slider to retint the generated web palette. This updates <code>web.theme_hue</code> and rewrites the generated web colors in <code>style.yaml</code>.</p>
<div class="panel">
  <div class="slider-row">
    <div class="slider-group">
      <label for="hue">Theme hue</label>
      <input id="hue" type="range" min="0" max="359" value="${hue}" oninput="updateFromSlider()">
      <div class="value-row">
        <span id="hue-value">${hue}deg</span>
        <span id="accent-value">${generated.light.accent}</span>
      </div>
    </div>
    <div id="hue-chip" class="hue-chip"></div>
  </div>
  <div class="preview-grid">
    <section id="light-preview" class="preview-card"></section>
    <section id="dark-preview" class="preview-card"></section>
  </div>
  <div id="token-row" class="token-row"></div>
</div>
<div class="actions">
  <button onclick="save()">Save to style.yaml</button>
  <span id="status"></span>
</div>
<script>
  const state = { hue: ${hue}, palette: ${JSON.stringify(generated)} };

  function hslToRgb(hue, saturation, lightness) {
    const s = Math.max(0, Math.min(100, saturation)) / 100;
    const l = Math.max(0, Math.min(100, lightness)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const h = ((hue % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs(h % 2 - 1));
    let red = 0;
    let green = 0;
    let blue = 0;

    if (h >= 0 && h < 1) {
      red = c;
      green = x;
    } else if (h < 2) {
      red = x;
      green = c;
    } else if (h < 3) {
      green = c;
      blue = x;
    } else if (h < 4) {
      green = x;
      blue = c;
    } else if (h < 5) {
      red = x;
      blue = c;
    } else {
      red = c;
      blue = x;
    }

    const match = l - c / 2;
    return {
      red: Math.round((red + match) * 255),
      green: Math.round((green + match) * 255),
      blue: Math.round((blue + match) * 255),
    };
  }

  function rgbToHex(rgb) {
    return '#' + [rgb.red, rgb.green, rgb.blue].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function rgba(rgb, alpha) {
    return 'rgba(' + rgb.red + ', ' + rgb.green + ', ' + rgb.blue + ', ' + alpha + ')';
  }

  function generatePalette(hue) {
    const accentLight = hslToRgb(hue, 54, 36);
    const accentDark = hslToRgb(hue, 100, 77);
    const mutedLight = hslToRgb(hue, 11, 53);
    const mutedDark = hslToRgb(hue, 39, 64);
    return {
      light: {
        bg_top: rgbToHex(hslToRgb(hue, 65, 98)),
        bg_bottom: rgbToHex(hslToRgb(hue, 28, 92)),
        surface: rgba(hslToRgb(hue, 20, 100), 0.92),
        surface_strong: rgba(hslToRgb(hue, 27, 95), 0.55),
        border_soft: rgba(accentLight, 0.12),
        border_strong: rgba(accentLight, 0.16),
        shadow: rgba(hslToRgb(hue, 28, 17), 0.12),
        card_alt: 'white',
        hero_glow: rgba(accentLight, 0.18),
        primary: rgbToHex(hslToRgb(hue, 8, 10)),
        secondary: rgbToHex(hslToRgb(hue, 9, 29)),
        accent: rgbToHex(accentLight),
        light: rgbToHex(hslToRgb(hue, 28, 94)),
        muted: rgbToHex(mutedLight),
      },
      dark: {
        bg_top: rgbToHex(hslToRgb(hue, 27, 10)),
        bg_bottom: rgbToHex(hslToRgb(hue, 28, 5)),
        surface: rgba(hslToRgb(hue, 24, 10), 0.94),
        surface_strong: rgba(hslToRgb(hue, 23, 16), 0.84),
        border_soft: rgba(accentDark, 0.18),
        border_strong: rgba(accentDark, 0.24),
        shadow: 'rgba(0, 0, 0, 0.35)',
        card_alt: rgba(hslToRgb(hue, 22, 7), 0.95),
        hero_glow: rgba(accentDark, 0.18),
        primary: rgbToHex(hslToRgb(hue, 31, 93)),
        secondary: rgbToHex(hslToRgb(hue, 28, 77)),
        accent: rgbToHex(accentDark),
        light: rgba(accentDark, 0.1),
        muted: rgbToHex(mutedDark),
      },
    };
  }

  function renderPreview(targetId, mode, palette) {
    const target = document.getElementById(targetId);
    target.style.background = palette.surface;
    target.style.borderColor = palette.border_strong;
    target.innerHTML = 
      '<div class="preview-hero" style="background: radial-gradient(circle at top left, ' + palette.hero_glow + ', transparent 34%), linear-gradient(135deg, ' + palette.surface_strong + ', ' + palette.surface + '); color: ' + palette.primary + '; border-bottom: 1px solid ' + palette.border_soft + ';">' +
        '<h2>' + mode + ' mode</h2>' +
        '<p style="color: ' + palette.secondary + ';">Accent and supporting surfaces update from the same hue.</p>' +
      '</div>' +
      '<div class="preview-body" style="background: linear-gradient(180deg, ' + palette.bg_top + ', ' + palette.bg_bottom + '); color: ' + palette.primary + ';">' +
        '<div class="preview-item" style="background: ' + palette.light + '; color: ' + palette.primary + ';">Prep card</div>' +
        '<div class="preview-item" style="background: ' + palette.card_alt + '; color: ' + palette.primary + '; border: 1px solid ' + palette.border_soft + ';">Equipment card</div>' +
        '<div class="preview-item" style="background: transparent; color: ' + palette.accent + '; border: 1px dashed ' + palette.border_strong + ';">Cook heading accent</div>' +
      '</div>';
  }

  function renderTokens(palette) {
    const target = document.getElementById('token-row');
    const tokens = [
      ['Light accent', palette.light.accent],
      ['Light muted', palette.light.muted],
      ['Dark accent', palette.dark.accent],
      ['Dark muted', palette.dark.muted],
    ];
    target.innerHTML = tokens.map(([label, value]) =>
      '<div class="token">' +
        '<div class="token-swatch" style="background: ' + value + ';"></div>' +
        '<div class="token-label">' + label + '<br>' + value + '</div>' +
      '</div>'
    ).join('');
  }

  function render() {
    const hue = state.hue;
    state.palette = generatePalette(hue);
    document.getElementById('hue-value').textContent = hue + 'deg';
    document.getElementById('accent-value').textContent = state.palette.light.accent;
    document.getElementById('hue-chip').style.background = 'hsl(' + hue + ' 70% 55%)';
    renderPreview('light-preview', 'Light', state.palette.light);
    renderPreview('dark-preview', 'Dark', state.palette.dark);
    renderTokens(state.palette);
  }

  function updateFromSlider() {
    state.hue = Number(document.getElementById('hue').value);
    render();
  }

  render();

  async function save() {
    const status = document.getElementById('status');
    status.className = '';
    status.textContent = 'Saving…';
    try {
      const res = await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hue: state.hue }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      status.textContent = '✓ Saved';
    } catch (err) {
      status.className = 'error';
      status.textContent = 'Error: ' + err.message;
    }
  }
</script>
</body>
</html>`;
}

function dumpWebBlock(web) {
  const webYaml = yaml.dump({ web }, { lineWidth: 120, quotingType: '"', forceQuotes: true }).trimEnd();
  return `${webYaml}\n`;
}

async function applyPalette(style, { hue }) {
  const generated = generatePalette(hue);
  style.web = {
    ...style.web,
    theme_hue: hue,
    light: generated.light,
    dark: generated.dark,
  };
  const raw = await fs.readFile(STYLE_PATH, 'utf8');
  const webBlock = dumpWebBlock(style.web);
  const newYaml = raw.replace(/\nweb:\n[\s\S]*?\n(?=decorations:)/, `\n${webBlock}\n`);
  await fs.writeFile(STYLE_PATH, newYaml, 'utf8');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const page = buildPage(yaml.load(await fs.readFile(STYLE_PATH, 'utf8')));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }
  if (req.method === 'POST' && req.url === '/save') {
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.hue !== 'number' || Number.isNaN(body.hue)) {
        throw new Error('Expected numeric hue');
      }
      const fresh = yaml.load(await fs.readFile(STYLE_PATH, 'utf8'));
      await applyPalette(fresh, { hue: Math.round(clamp(body.hue, 0, 359)) });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message);
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const PORT = 3579;
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Palette editor running at ${url}`);
  process.stdout.write(`\x1b]8;;${url}\x1b\\Open in browser\x1b]8;;\x1b\\\n`);
  console.log('Press Ctrl-C to stop.');
  // Auto-open in default browser
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
});
