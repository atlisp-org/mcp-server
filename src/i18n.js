import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, 'locales');

const SUPPORTED_LOCALES = ['zh-CN', 'en'];
const DEFAULT_LOCALE = 'zh-CN';

let currentLocale = DEFAULT_LOCALE;
let messages = {};

function loadLocaleFile(locale) {
  const filePath = path.join(localesDir, `${locale}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadLocale(locale) {
  const data = loadLocaleFile(locale);
  if (!data) return false;
  messages = data;
  currentLocale = locale;
  return true;
}

export function t(key, params) {
  let text = messages[key];
  if (text == null) {
    if (currentLocale !== DEFAULT_LOCALE) {
      const defaultData = loadLocaleFile(DEFAULT_LOCALE);
      text = defaultData ? defaultData[key] : null;
    }
    if (text == null) return key;
  }
  if (params && Array.isArray(params)) {
    for (let i = 0; i < params.length; i++) {
      text = text.replaceAll(`{${i}}`, String(params[i] ?? ''));
    }
  }
  return text;
}

export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;
  return loadLocale(locale);
}

export function getLocale() {
  return currentLocale;
}

export function detectLocale(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') return DEFAULT_LOCALE;

  const tags = acceptLanguage.split(',');
  const weighted = [];

  for (const tag of tags) {
    const [lang, qStr] = tag.trim().split(';');
    const code = lang.trim();
    const q = qStr ? parseFloat(qStr.replace(/^q\s*=\s*/, '') || '1') : 1;
    weighted.push({ code, q });
  }

  weighted.sort((a, b) => b.q - a.q);

  const localeMap = {
    'zh': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-CN': 'zh-CN',
    'zh-hans': 'zh-CN', 'zh-Hans': 'zh-CN',
    'en': 'en', 'en-us': 'en', 'en-US': 'en',
    'en-gb': 'en', 'en-GB': 'en',
  };

  for (const { code } of weighted) {
    const mapped = localeMap[code];
    if (mapped && SUPPORTED_LOCALES.includes(mapped)) return mapped;
  }

  return DEFAULT_LOCALE;
}

// Eager load default locale
loadLocale(DEFAULT_LOCALE);
