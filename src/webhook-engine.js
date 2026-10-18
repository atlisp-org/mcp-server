import fs from 'fs';
import path from 'path';
import os from 'os';
import {  error as logError } from './logger.js';
import { ensureDir } from './handler-utils.js';

const WEBHOOKS_FILE = path.join(os.homedir(), '.atlisp', 'webhooks.json');
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
let webhooks = [];

function loadWebhooks() {
  try {
    if (fs.existsSync(WEBHOOKS_FILE)) {
      webhooks = JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf-8'));
    }
  } catch (e) { logError(`Webhook load error: ${e.message}`); }
}

function saveWebhooks() {
  try {
    ensureDir(path.dirname(WEBHOOKS_FILE));
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2), 'utf-8');
  } catch (e) { logError(`Webhook save error: ${e.message}`); }
}

loadWebhooks();

export function registerWebhook({ url, events, name, secret }) {
  if (!url) throw new Error('Webhook URL is required');
  if (!events || !Array.isArray(events) || events.length === 0) throw new Error('At least one event is required');
  const validEvents = ['tool_executed', 'package_installed', 'cad_connected', 'cad_disconnected', 'error_occurred', 'dwg_opened', 'dwg_saved', 'dwg_closed', 'entity_created', 'layer_changed', 'plot_completed'];
  for (const ev of events) {
    if (!validEvents.includes(ev)) throw new Error(`无效的事件类型: ${ev}，支持: ${validEvents.join(', ')}`);
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`不支持的协议: ${parsed.protocol}，仅支持 http/https`);
    }
  } catch (e) {
    if (e.message.includes('不支持的协议')) throw e;
    throw new Error(`无效的 URL: ${e.message}`, { cause: e });
  }
  const wh = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || `webhook_${webhooks.length + 1}`,
    url,
    events,
    secret: secret || '',
    active: true,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    failCount: 0,
  };
  webhooks.push(wh);
  saveWebhooks();
  return wh;
}

export function removeWebhook(id) {
  const idx = webhooks.findIndex(w => w.id === id);
  if (idx === -1) return false;
  webhooks.splice(idx, 1);
  saveWebhooks();
  return true;
}

export function listWebhooks() {
  return webhooks.map(w => ({
    id: w.id, name: w.name, url: w.url, events: w.events,
    active: w.active, createdAt: w.createdAt, lastTriggered: w.lastTriggered, failCount: w.failCount,
  }));
}

export function triggerWebhook(event, payload) {
  const matched = webhooks.filter(w => w.active && w.events.includes(event));
  for (const wh of matched) {
    fireWebhook(wh, event, payload).catch(() => {});
  }
  return matched.length;
}

async function fireWebhook(wh, event, payload) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString(), webhookId: wh.id });
      const headers = { 'Content-Type': 'application/json' };
      if (wh.secret) headers['X-Webhook-Secret'] = wh.secret;
      
      const response = await fetch(wh.url, {
        method: 'POST', headers, body,
        // 单次投递超时，避免慢端点把重试链拖成无限挂起
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        wh.lastTriggered = new Date().toISOString();
        wh.failCount = 0;
        saveWebhooks();
        return;
      }
      wh.failCount = (wh.failCount || 0) + 1;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        logError(`Webhook ${wh.name} returned ${response.status}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        logError(`Webhook ${wh.name} failed after ${MAX_RETRIES} retries (status ${response.status})`);
      }
    } catch (e) {
      wh.failCount = (wh.failCount || 0) + 1;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        logError(`Webhook ${wh.name} failed: ${e.message}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        logError(`Webhook ${wh.name} failed after ${MAX_RETRIES} retries: ${e.message}`);
      }
    }
  }
  saveWebhooks();
}

export function getWebhookLog(id) {
  const sanitized = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const logPath = path.join(os.homedir(), '.atlisp', `webhook-${sanitized}.log`);
  try {
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) { logError(`Webhook log read error [${sanitized}]: ${e.message}`); return []; }
}

export { WEBHOOKS_FILE };

export function triggerWebhookEvent(event, payload) {
    return triggerWebhook(event, payload);
}
