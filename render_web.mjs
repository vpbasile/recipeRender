#!/usr/bin/env node

import yaml from 'js-yaml';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, 'docs');
const RECIPES_DIR = path.join(__dirname, 'recipes');
const STYLE_PATH = path.join(__dirname, 'style.yaml');
const PYTHON_BIN = path.join(__dirname, '.venv', 'bin', 'python');

function fontStack(fontName) {
  if (fontName.startsWith('Times')) {
    return 'Georgia, "Times New Roman", serif';
  }
  if (fontName.startsWith('Helvetica')) {
    return 'Arial, Helvetica, sans-serif';
  }
  if (fontName.startsWith('Courier')) {
    return '"Courier New", monospace';
  }
  return 'system-ui, sans-serif';
}

async function chooseRecipePaths() {
  let recipeFiles;
  try {
    recipeFiles = (await fs.readdir(RECIPES_DIR))
      .filter((name) => /\.ya?ml$/i.test(name))
      .sort();
  } catch (error) {
    throw new Error(`Recipes directory not found: ${RECIPES_DIR}`);
  }

  if (recipeFiles.length === 0) {
    throw new Error(`No recipe files found in: ${RECIPES_DIR}`);
  }

  console.log('Choose a recipe:');
  console.log('  0) All recipes');
  recipeFiles.forEach((name, index) => {
    console.log(`  ${index + 1}) ${name}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const choice = (await rl.question(`Enter number (0-${recipeFiles.length}): `)).trim();
      if (/^\d+$/.test(choice)) {
        const index = Number(choice);
        if (index === 0) {
          return recipeFiles.map((name) => path.join(RECIPES_DIR, name));
        }
        if (index >= 1 && index <= recipeFiles.length) {
          return [path.join(RECIPES_DIR, recipeFiles[index - 1])];
        }
      }
      console.log('Invalid selection. Try again.');
    }
  } finally {
    rl.close();
  }
}

async function loadRecipe(recipePath) {
  const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [path.join(__dirname, 'recipe_json.py'), recipePath]);
  if (stderr) {
    throw new Error(stderr.trim());
  }
  return JSON.parse(stdout);
}

async function loadStyle() {
  const raw = await fs.readFile(STYLE_PATH, 'utf8');
  return yaml.load(raw);
}

function splitPrep(prep) {
  return prep.map((entry) => {
    if (entry.text) {
      return { type: 'step', text: entry.text };
    }
    return { type: 'vessel', name: entry.name, steps: entry.steps };
  });
}

function HtmlDocument({ recipe, style }) {
  const bodyFont = fontStack(style.fonts.body);
  const titleFont = fontStack(style.fonts.title);
  const headingFont = fontStack(style.fonts.heading);
  const labelFont = fontStack(style.fonts.label);
  const prepEntries = splitPrep(recipe.prep);
  const bullet = style.decorations.step_bullet;
  const script = `
    (() => {
      const root = document.documentElement;
      const themeButton = document.getElementById('theme-toggle');
      const wakeButton = document.getElementById('wake-toggle');
      const themeStorageKey = 'recipe-render-theme';
      let wakeLock = null;

      function applyTheme(theme) {
        root.dataset.theme = theme;
        localStorage.setItem(themeStorageKey, theme);
        if (themeButton) {
          themeButton.textContent = theme === 'dark' ? 'Color mode: Dark' : 'Color mode: Light';
          themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
        }
      }

      function updateWakeButton(active, supported) {
        if (!wakeButton) {
          return;
        }
        if (!supported) {
          wakeButton.textContent = 'Keep awake unavailable';
          wakeButton.disabled = true;
          wakeButton.setAttribute('aria-disabled', 'true');
          return;
        }
        wakeButton.disabled = false;
        wakeButton.removeAttribute('aria-disabled');
        wakeButton.textContent = active ? 'Keep screen awake: Off' : 'Keep screen awake: On';
        wakeButton.setAttribute('aria-pressed', String(active));
      }

      async function requestWakeLock() {
        if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) {
          updateWakeButton(false, false);
          return;
        }
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          updateWakeButton(true, true);
          wakeLock.addEventListener('release', () => {
            wakeLock = null;
            updateWakeButton(false, true);
          });
        } catch {
          updateWakeButton(false, true);
        }
      }

      async function releaseWakeLock() {
        if (!wakeLock) {
          updateWakeButton(false, 'wakeLock' in navigator);
          return;
        }
        try {
          await wakeLock.release();
        } finally {
          wakeLock = null;
          updateWakeButton(false, true);
        }
      }

      const storedTheme = localStorage.getItem(themeStorageKey);
      const preferredTheme = storedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      applyTheme(preferredTheme);
      updateWakeButton(false, 'wakeLock' in navigator && !!navigator.wakeLock?.request);

      themeButton?.addEventListener('click', () => {
        applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
      });

      wakeButton?.addEventListener('click', async () => {
        if (wakeLock) {
          await releaseWakeLock();
          return;
        }
        await requestWakeLock();
      });

      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && wakeLock) {
          await requestWakeLock();
        }
      });
    })();
  `;

  const { light: lc, dark: dc } = style.web;
  const css = `
    :root {
      --primary: ${lc.primary};
      --secondary: ${lc.secondary};
      --accent: ${lc.accent};
      --light: ${lc.light};
      --muted: ${lc.muted};
      --bg-top: ${lc.bg_top};
      --bg-bottom: ${lc.bg_bottom};
      --surface: ${lc.surface};
      --surface-strong: ${lc.surface_strong};
      --border-soft: ${lc.border_soft};
      --border-strong: ${lc.border_strong};
      --shadow: ${lc.shadow};
      --card-alt: ${lc.card_alt};
      --hero-glow: ${lc.hero_glow};
      --title-font: ${titleFont};
      --heading-font: ${headingFont};
      --body-font: ${bodyFont};
      --label-font: ${labelFont};
      --title-size: ${style.sizes.title}px;
      --subtitle-size: ${style.sizes.subtitle}px;
      --page-heading-size: ${style.sizes.page_heading}px;
      --phase-heading-size: ${style.sizes.phase_heading}px;
      --label-size: ${style.sizes.vessel_label}px;
      --body-size: ${style.sizes.body}px;
    }
    :root[data-theme="dark"] {
      --primary: ${dc.primary};
      --secondary: ${dc.secondary};
      --accent: ${dc.accent};
      --light: ${dc.light};
      --muted: ${dc.muted};
      --bg-top: ${dc.bg_top};
      --bg-bottom: ${dc.bg_bottom};
      --surface: ${dc.surface};
      --surface-strong: ${dc.surface_strong};
      --border-soft: ${dc.border_soft};
      --border-strong: ${dc.border_strong};
      --shadow: ${dc.shadow};
      --card-alt: ${dc.card_alt};
      --hero-glow: ${dc.hero_glow};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 40px 20px 64px;
      background: linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
      color: var(--primary);
      font-family: var(--body-font);
      line-height: 1.5;
      transition: background 180ms ease, color 180ms ease;
    }
    .shell {
      max-width: 980px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 60px var(--shadow);
      backdrop-filter: blur(8px);
      transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
    }
    .hero {
      padding: 40px 40px 24px;
      background:
        radial-gradient(circle at top left, var(--hero-glow), transparent 34%),
        linear-gradient(135deg, var(--surface-strong), var(--surface));
      border-bottom: 1px solid var(--border-soft);
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
    }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .control-button {
      appearance: none;
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.32);
      color: var(--primary);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }
    :root[data-theme="dark"] .control-button {
      background: rgba(255, 255, 255, 0.06);
    }
    .control-button:hover:not(:disabled) {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.48);
    }
    :root[data-theme="dark"] .control-button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
    .control-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    h1 {
      margin: 0;
      font-family: var(--title-font);
      font-size: var(--title-size);
      font-weight: 400;
      line-height: 1.1;
    }
    .subtitle {
      margin-top: 10px;
      max-width: 56rem;
      color: var(--secondary);
      font-size: var(--subtitle-size);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
      gap: 0;
    }
    .sidebar {
      padding: 28px 28px 36px;
      background: var(--surface-strong);
      border-right: 1px solid var(--border-soft);
    }
    .content {
      padding: 28px 32px 36px;
    }
    .section-title, .page-title, .phase-title {
      margin: 0 0 12px;
      font-family: var(--heading-font);
      color: var(--accent);
    }
    .page-title {
      font-size: var(--page-heading-size);
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-strong);
    }
    .section-title {
      font-size: calc(var(--phase-heading-size) + 1px);
    }
    .phase-title {
      font-size: var(--phase-heading-size);
      margin-top: 20px;
    }
    .card-list, .step-list {
      display: grid;
      gap: 8px;
    }
    .card-item {
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--light);
      font-size: var(--body-size);
    }
    .card-item.alt-off {
      background: var(--card-alt);
      border: 1px solid var(--border-soft);
    }
    .step-item {
      padding: 0;
      font-size: var(--body-size);
    }
    .vessel-label {
      margin: 18px 0 8px;
      color: var(--muted);
      font-family: var(--label-font);
      font-size: var(--label-size);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .cook-step strong {
      color: var(--accent);
      margin-right: 6px;
    }
    .page-block + .page-block {
      margin-top: 28px;
    }
    @media (max-width: 820px) {
      .hero-top {
        flex-direction: column;
      }
      .controls {
        justify-content: flex-start;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--border-soft);
      }
      .hero, .sidebar, .content {
        padding-left: 20px;
        padding-right: 20px;
      }
    }
  `;

  return React.createElement(
    'html',
    { lang: 'en' },
    React.createElement(
      'head',
      null,
      React.createElement('meta', { charSet: 'utf-8' }),
      React.createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      React.createElement('title', null, recipe.title),
      React.createElement('style', null, css),
    ),
    React.createElement(
      'body',
      null,
      React.createElement(
        'main',
        { className: 'shell' },
        React.createElement(
          'header',
          { className: 'hero' },
          React.createElement(
            'div',
            { className: 'hero-top' },
            React.createElement('h1', null, recipe.title),
            React.createElement(
              'div',
              { className: 'controls' },
              React.createElement('button', {
                id: 'theme-toggle',
                className: 'control-button',
                type: 'button',
                'aria-pressed': 'false',
              }, 'Dark mode'),
              React.createElement('button', {
                id: 'wake-toggle',
                className: 'control-button',
                type: 'button',
                'aria-pressed': 'false',
              }, 'Keep screen awake'),
            ),
          ),
          recipe.subtitle ? React.createElement('p', { className: 'subtitle' }, recipe.subtitle) : null,
        ),
        React.createElement(
          'div',
          { className: 'grid' },
          React.createElement(
            'aside',
            { className: 'sidebar' },
            React.createElement('h2', { className: 'page-title' }, 'You Will Need'),
            React.createElement('section', { className: 'page-block' },
              React.createElement('h3', { className: 'section-title' }, 'Ingredients'),
              React.createElement('div', { className: 'card-list' },
                recipe.ingredients.map((item, index) => React.createElement('div', {
                  className: `card-item ${style.decorations.alternate_ingredient_rows && index % 2 === 1 ? 'alt-off' : ''}`,
                  key: `ingredient-${index}`,
                }, item)),
              ),
            ),
            recipe.equipment.length > 0 ? React.createElement('section', { className: 'page-block' },
              React.createElement('h3', { className: 'section-title' }, 'Equipment'),
              React.createElement('div', { className: 'card-list' },
                recipe.equipment.map((item, index) => React.createElement('div', {
                  className: `card-item ${style.decorations.alternate_ingredient_rows && index % 2 === 1 ? 'alt-off' : ''}`,
                  key: `equipment-${index}`,
                }, item)),
              ),
            ) : null,
          ),
          React.createElement(
            'section',
            { className: 'content' },
            React.createElement('h2', { className: 'page-title' }, 'Prep'),
            React.createElement('div', { className: 'step-list' },
              prepEntries.flatMap((entry, index) => {
                if (entry.type === 'step') {
                  return React.createElement('div', { className: 'step-item', key: `prep-step-${index}` }, `${bullet} ${entry.text}`);
                }
                const nodes = [];
                if (entry.name) {
                  nodes.push(React.createElement('div', { className: 'vessel-label', key: `vessel-${index}` }, `In a ${entry.name}`));
                }
                entry.steps.forEach((step, stepIndex) => {
                  nodes.push(React.createElement('div', { className: 'step-item', key: `vessel-step-${index}-${stepIndex}` }, `${bullet} ${step}`));
                });
                return nodes;
              }),
            ),
            React.createElement('h2', { className: 'page-title', style: { marginTop: '28px' } }, 'Cook'),
            recipe.cook.map((phase, phaseIndex) => React.createElement('section', { className: 'page-block', key: `phase-${phaseIndex}` },
              React.createElement('h3', { className: 'phase-title' }, phase.name),
              React.createElement('div', { className: 'step-list' },
                phase.steps.map((step, stepIndex) => {
                  const number = recipe.cook.slice(0, phaseIndex).reduce((count, item) => count + item.steps.length, 0) + stepIndex + 1;
                  return React.createElement('div', { className: 'step-item cook-step', key: `cook-step-${phaseIndex}-${stepIndex}` },
                    React.createElement('strong', null, `${number}.`),
                    step,
                  );
                }),
              ),
            )),
          ),
        ),
      ),
      React.createElement('script', { dangerouslySetInnerHTML: { __html: script } }),
    ),
  );
}

function IndexDocument({ recipes, style }) {
  const bodyFont = fontStack(style.fonts.body);
  const titleFont = fontStack(style.fonts.title);
  const headingFont = fontStack(style.fonts.heading);
  const script = `
    (() => {
      const root = document.documentElement;
      const themeButton = document.getElementById('theme-toggle');
      const wakeButton = document.getElementById('wake-toggle');
      const themeStorageKey = 'recipe-render-theme';
      let wakeLock = null;

      function applyTheme(theme) {
        root.dataset.theme = theme;
        localStorage.setItem(themeStorageKey, theme);
        if (themeButton) {
          themeButton.textContent = theme === 'dark' ? 'Color mode: Dark' : 'Color mode: Light';
          themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
        }
      }

      function updateWakeButton(active, supported) {
        if (!wakeButton) return;
        if (!supported) {
          wakeButton.textContent = 'Keep awake unavailable';
          wakeButton.disabled = true;
          wakeButton.setAttribute('aria-disabled', 'true');
          return;
        }
        wakeButton.disabled = false;
        wakeButton.removeAttribute('aria-disabled');
        wakeButton.textContent = active ? 'Keep screen awake: Off' : 'Keep screen awake: On';
        wakeButton.setAttribute('aria-pressed', String(active));
      }

      async function requestWakeLock() {
        if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) {
          updateWakeButton(false, false);
          return;
        }
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          updateWakeButton(true, true);
          wakeLock.addEventListener('release', () => { wakeLock = null; updateWakeButton(false, true); });
        } catch { updateWakeButton(false, true); }
      }

      async function releaseWakeLock() {
        if (!wakeLock) { updateWakeButton(false, 'wakeLock' in navigator); return; }
        try { await wakeLock.release(); } finally { wakeLock = null; updateWakeButton(false, true); }
      }

      const storedTheme = localStorage.getItem(themeStorageKey);
      const preferredTheme = storedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      applyTheme(preferredTheme);
      updateWakeButton(false, 'wakeLock' in navigator && !!navigator.wakeLock?.request);

      themeButton?.addEventListener('click', () => {
        applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
      });

      wakeButton?.addEventListener('click', async () => {
        if (wakeLock) { await releaseWakeLock(); return; }
        await requestWakeLock();
      });

      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && wakeLock) await requestWakeLock();
      });
    })();
  `;

  const { light: lc, dark: dc } = style.web;
  const css = `
    :root {
      --primary: ${lc.primary};
      --secondary: ${lc.secondary};
      --accent: ${lc.accent};
      --light: ${lc.light};
      --muted: ${lc.muted};
      --bg-top: ${lc.bg_top};
      --bg-bottom: ${lc.bg_bottom};
      --surface: ${lc.surface};
      --surface-strong: ${lc.surface_strong};
      --border-soft: ${lc.border_soft};
      --border-strong: ${lc.border_strong};
      --shadow: ${lc.shadow};
      --hero-glow: ${lc.hero_glow};
      --title-font: ${titleFont};
      --heading-font: ${headingFont};
      --body-font: ${bodyFont};
    }
    :root[data-theme="dark"] {
      --primary: ${dc.primary};
      --secondary: ${dc.secondary};
      --accent: ${dc.accent};
      --light: ${dc.light};
      --muted: ${dc.muted};
      --bg-top: ${dc.bg_top};
      --bg-bottom: ${dc.bg_bottom};
      --surface: ${dc.surface};
      --surface-strong: ${dc.surface_strong};
      --border-soft: ${dc.border_soft};
      --border-strong: ${dc.border_strong};
      --shadow: ${dc.shadow};
      --hero-glow: ${dc.hero_glow};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 40px 20px 64px;
      background: linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
      color: var(--primary);
      font-family: var(--body-font);
      line-height: 1.5;
      transition: background 180ms ease, color 180ms ease;
    }
    .shell {
      max-width: 980px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 60px var(--shadow);
      backdrop-filter: blur(8px);
      transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
    }
    .hero {
      padding: 40px 40px 24px;
      background:
        radial-gradient(circle at top left, var(--hero-glow), transparent 34%),
        linear-gradient(135deg, var(--surface-strong), var(--surface));
      border-bottom: 1px solid var(--border-soft);
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
    }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .control-button {
      appearance: none;
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.32);
      color: var(--primary);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }
    :root[data-theme="dark"] .control-button {
      background: rgba(255, 255, 255, 0.06);
    }
    .control-button:hover:not(:disabled) {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.48);
    }
    :root[data-theme="dark"] .control-button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
    .control-button:disabled { opacity: 0.6; cursor: not-allowed; }
    h1 {
      margin: 0;
      font-family: var(--title-font);
      font-size: 2.4rem;
      font-weight: 400;
      line-height: 1.1;
    }
    .content { padding: 32px 40px 40px; }
    .recipe-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 8px;
    }
    .recipe-card {
      display: block;
      padding: 20px 22px;
      background: var(--light);
      border: 1px solid var(--border-soft);
      border-radius: 16px;
      text-decoration: none;
      color: var(--primary);
      font-family: var(--heading-font);
      font-size: 1.1rem;
      transition: background 160ms ease, transform 160ms ease, border-color 160ms ease;
    }
    .recipe-card:hover {
      background: var(--surface-strong);
      border-color: var(--border-strong);
      transform: translateY(-2px);
    }
    @media (max-width: 640px) {
      .hero-top { flex-direction: column; }
      .controls { justify-content: flex-start; }
      .hero, .content { padding-left: 20px; padding-right: 20px; }
    }
  `;

  return React.createElement(
    'html',
    { lang: 'en' },
    React.createElement(
      'head',
      null,
      React.createElement('meta', { charSet: 'utf-8' }),
      React.createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      React.createElement('title', null, 'Recipes'),
      React.createElement('style', null, css),
    ),
    React.createElement(
      'body',
      null,
      React.createElement(
        'main',
        { className: 'shell' },
        React.createElement(
          'header',
          { className: 'hero' },
          React.createElement(
            'div',
            { className: 'hero-top' },
            React.createElement('h1', null, 'Recipes'),
            React.createElement(
              'div',
              { className: 'controls' },
              React.createElement('button', {
                id: 'theme-toggle',
                className: 'control-button',
                type: 'button',
                'aria-pressed': 'false',
              }, 'Dark mode'),
              React.createElement('button', {
                id: 'wake-toggle',
                className: 'control-button',
                type: 'button',
                'aria-pressed': 'false',
              }, 'Keep screen awake'),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'content' },
          React.createElement(
            'div',
            { className: 'recipe-grid' },
            recipes.map(({ title, filename }) =>
              React.createElement('a', { className: 'recipe-card', href: filename, key: filename }, title),
            ),
          ),
        ),
      ),
      React.createElement('script', { dangerouslySetInnerHTML: { __html: script } }),
    ),
  );
}

async function main() {
  if (process.argv.length > 2) {
    console.error('Error: command-line recipe arguments are no longer supported.');
    console.error('Run node render_web.mjs and choose from the menu.');
    process.exit(1);
  }

  try {
    await fs.access(PYTHON_BIN);
  } catch {
    console.error(`Error: Python environment not found at ${PYTHON_BIN}`);
    process.exit(1);
  }

  let recipePaths;
  try {
    recipePaths = await chooseRecipePaths();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  let style;
  try {
    style = await loadStyle();
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const renderedRecipes = [];

  for (const recipePath of recipePaths) {
    const stem = path.basename(recipePath, path.extname(recipePath));
    const outputPath = path.join(OUTPUT_DIR, `${stem}.html`);

    try {
      const recipe = await loadRecipe(recipePath);
      const markup = '<!DOCTYPE html>' + renderToStaticMarkup(React.createElement(HtmlDocument, { recipe, style }));
      await fs.writeFile(outputPath, markup + '\n', 'utf8');
      renderedRecipes.push({ title: recipe.title, filename: `${stem}.html` });
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }

    console.log(`HTML written to: ${outputPath}`);
  }

  if (renderedRecipes.length > 1) {
    const indexPath = path.join(OUTPUT_DIR, 'index.html');
    const indexMarkup = '<!DOCTYPE html>' + renderToStaticMarkup(React.createElement(IndexDocument, { recipes: renderedRecipes, style }));
    await fs.writeFile(indexPath, indexMarkup + '\n', 'utf8');
    console.log(`Index written to: ${indexPath}`);
  }

  const dirUrl = `file://${OUTPUT_DIR}`;
  process.stdout.write(`\x1b]8;;${dirUrl}\x1b\\📂 Open output folder\x1b]8;;\x1b\\\n`);
}

main();
