import { handleToolCall } from './mcp-tools.js';
import { log, error as logError } from './logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PIPELINE_DIR = path.join(os.homedir(), '.atlisp', 'pipelines');
const savedPipelines = new Map();

function ensureDir() {
    try { if (!fs.existsSync(PIPELINE_DIR)) fs.mkdirSync(PIPELINE_DIR, { recursive: true }); } catch (e) { logError(`Pipeline dir error: ${e.message}`); }
}

function resolveRef(ref, results) {
    const match = ref.match(/^\$ref:(.+)\.(.+)$/);
    if (!match) return ref;
    const [, stepName, propPath] = match;
    const stepResult = results.get(stepName);
    if (!stepResult) throw new Error(`Pipeline ref error: step "${stepName}" not found`);
    const props = propPath.split('.');
    let val = stepResult;
    for (const p of props) {
        if (val == null) throw new Error(`Pipeline ref error: "${stepName}.${propPath}" is null`);
        val = val[p];
    }
    return val;
}

function resolveArgs(args, results) {
    if (args == null || typeof args === 'string') {
        if (typeof args === 'string' && args.startsWith('$ref:')) return resolveRef(args, results);
        return args;
    }
    if (Array.isArray(args)) return args.map(a => resolveArgs(a, results));
    if (typeof args === 'object') {
        const resolved = {};
        for (const [k, v] of Object.entries(args)) {
            resolved[k] = resolveArgs(v, results);
        }
        return resolved;
    }
    return args;
}

export async function executePipeline(steps, options = {}) {
    const results = new Map();
    const logEntries = [];
    const startTime = Date.now();

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const { name, tool, args, condition, continueOnError, timeout } = step;
        const stepStart = Date.now();

        if (!tool) {
            logEntries.push({ step: name || i, status: 'error', error: 'Missing tool name', duration: 0 });
            if (!continueOnError) throw new Error(`Pipeline step ${i}: missing tool name`);
            continue;
        }

        if (condition) {
            const conditionResult = evaluateCondition(condition, results);
            if (!conditionResult) {
                logEntries.push({ step: name || i, tool, status: 'skipped', reason: `condition: ${condition}`, duration: 0 });
                continue;
            }
        }

        try {
            const resolvedArgs = resolveArgs(args || {}, results);
            log(`Pipeline step ${i}: ${tool}`, { step: name, tool, args: resolvedArgs });

            const stepResult = await Promise.race([
                handleToolCall(tool, resolvedArgs, options),
                ...(timeout ? [new Promise((_, reject) => setTimeout(() => reject(new Error(`Step "${name || i}" timed out after ${timeout}ms`)), timeout))] : []),
            ]);

            const content = stepResult?.content?.[0]?.text || stepResult;
            const duration = Date.now() - stepStart;
            results.set(name || String(i), content);
            logEntries.push({
                step: name || i,
                tool,
                status: stepResult?.isError ? 'error' : 'success',
                duration,
                error: stepResult?.isError ? content : undefined,
            });

            if (stepResult?.isError && !continueOnError) {
                throw new Error(`Pipeline step "${name || i}" (${tool}) failed: ${content}`);
            }
        } catch (e) {
            const duration = Date.now() - stepStart;
            logEntries.push({ step: name || i, tool, status: 'error', error: e.message, duration });
            if (!continueOnError) throw e;
        }
    }

    return {
        success: logEntries.every(e => e.status === 'success' || e.status === 'skipped'),
        steps: logEntries,
        totalDuration: Date.now() - startTime,
        results: Object.fromEntries(results),
    };
}

function evaluateCondition(condition, results) {
    if (typeof condition === 'boolean') return condition;
    if (typeof condition === 'string') {
        const match = condition.match(/^\$ref:(.+)\.(.+)$/);
        if (match) {
            try {
                const val = resolveRef(condition, results);
                return !!val && val !== 'nil' && val !== 'undefined';
            } catch { return false; }
        }
        return true;
    }
    return true;
}

export async function savePipeline(name, steps) {
    ensureDir();
    const filePath = path.join(PIPELINE_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    const data = { name, steps, createdAt: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    savedPipelines.set(name, data);
    return true;
}

export function listPipelines() {
    ensureDir();
    const pipelines = [];
    try {
        const files = fs.readdirSync(PIPELINE_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(PIPELINE_DIR, file), 'utf-8'));
                pipelines.push({ name: data.name || file.replace('.json', ''), steps: data.steps?.length || 0, createdAt: data.createdAt });
            } catch (e) { logError(`Pipeline parse error [${file}]: ${e.message}`); }
        }
    } catch (e) { logError(`Pipeline list error: ${e.message}`); }
    return pipelines;
}

export function loadPipeline(name) {
    if (savedPipelines.has(name)) return savedPipelines.get(name);
    ensureDir();
    const filePath = path.join(PIPELINE_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        savedPipelines.set(name, data);
        return data;
    } catch { return null; }
}

export function deletePipeline(name) {
    const filePath = path.join(PIPELINE_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        savedPipelines.delete(name);
        return true;
    }
    return false;
}
