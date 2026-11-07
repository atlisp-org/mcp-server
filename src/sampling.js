import config from './config.js';
import { log, error as logError } from './logger.js';
import { metrics } from './metrics.js';

const PROVIDER_MAP = {
    'openai': { url: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY' },
    'deepseek': { url: 'https://api.deepseek.com/v1/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
    'vllm': { url: '', keyEnv: '' },
    'custom': { url: '', keyEnv: '' },
};

// 每 100 万 token 的美元价格（用于粗略成本记账，不参与计费）
const PRICING = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'deepseek-chat': { input: 0.27, output: 1.1 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

export function detectProvider(url = '') {
    if (url.includes('openai')) return 'openai';
    if (url.includes('deepseek')) return 'deepseek';
    if (url.includes('11434') || url.includes('vllm')) return 'vllm';
    return 'custom';
}

function getApiKey(provider) {
    if (provider === 'custom' && config.llmApiKey) return config.llmApiKey;
    const map = PROVIDER_MAP[provider];
    if (map?.keyEnv && process.env[map.keyEnv]) return process.env[map.keyEnv];
    if (config.llmApiKey && detectProvider(config.llmApiUrl) === provider) return config.llmApiKey;
    return '';
}

function getApiUrl(provider) {
    if (provider === 'custom') return config.llmApiUrl || '';
    const map = PROVIDER_MAP[provider];
    if (map?.url) return config.llmApiUrl && detectProvider(config.llmApiUrl) === provider
        ? config.llmApiUrl
        : map.url;
    return config.llmApiUrl || '';
}

/** 解析 SAMPLING_PROVIDERS（逗号分隔，如 "vllm,deepseek,openai"）。 */
export function parseProviderList(value = config.samplingProviders) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .filter((name) => Object.prototype.hasOwnProperty.call(PROVIDER_MAP, name));
}

function convertMessages(messages, systemPrompt) {
    const result = [];
    if (systemPrompt) {
        result.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
        const content = Array.isArray(msg.content)
            ? msg.content.map(c => c.type === 'text' ? c.text : '').join('\n')
            : (msg.content?.text || msg.content || '');
        result.push({ role: msg.role || 'user', content });
    }
    return result;
}

function echoResponse(messages) {
    const lastMsg = messages?.[messages.length - 1];
    const text = lastMsg?.content
        ? (Array.isArray(lastMsg.content) ? lastMsg.content.map(c => c.text || '').join(' ') : lastMsg.content.text || '')
        : '';
    return {
        model: 'echo',
        role: 'assistant',
        content: { type: 'text', text: `[echo] ${text}` },
        stopReason: 'endTurn',
    };
}

function estimateTokens(text) {
    return Math.max(0, Math.ceil(String(text || '').length / 4));
}

export function estimateCostUsd(model, inputTokens, outputTokens) {
    const price = PRICING[model] || null;
    if (!price) return 0;
    return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

function recordUsage({ provider, model, inputTokens, outputTokens }) {
    const cost = estimateCostUsd(model, inputTokens, outputTokens);
    // 单测环境不启动 Prometheus exporter（避免 9464 端口竞争），成本计算仍返回。
    if (process.env.NODE_ENV === 'test') return cost;
    try {
        metrics.increment('sampling_requests_total', { provider, model, status: 'success' });
        if (inputTokens) metrics.increment('sampling_tokens_input_total', { provider, model }, inputTokens);
        if (outputTokens) metrics.increment('sampling_tokens_output_total', { provider, model }, outputTokens);
        if (cost > 0) metrics.increment('sampling_cost_micros_total', { provider, model }, Math.round(cost * 1_000_000));
    } catch (e) {
        log(`Sampling: 成本记账失败 ${e.message}`);
    }
    return cost;
}

async function readSse(response) {
    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
        const raw = await response.text();
        return parseSseText(raw);
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const acc = { text: '', model: '', finishReason: '', usage: null };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            consumeSseLine(line, acc);
        }
    }
    if (buffer.trim()) consumeSseLine(buffer.trim(), acc);
    return acc;
}

function parseSseText(raw) {
    const acc = { text: '', model: '', finishReason: '', usage: null };
    for (const line of String(raw || '').split(/\r?\n/)) consumeSseLine(line.trim(), acc);
    return acc;
}

function consumeSseLine(line, acc) {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
        const json = JSON.parse(payload);
        if (json.model) acc.model = json.model;
        if (json.usage) acc.usage = json.usage;
        const choice = json.choices?.[0];
        if (!choice) return;
        if (choice.delta?.content) acc.text += choice.delta.content;
        if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    } catch {
        // 单个坏事件不应中断整段流
    }
}

async function callProvider({ provider, model, messages, systemPrompt, maxTokens, temperature, stopSequences, stream }) {
    const apiKey = getApiKey(provider);
    if (!apiKey) {
        const err = new Error(`missing API key for ${provider}`);
        err.code = 'NO_API_KEY';
        throw err;
    }
    const apiUrl = getApiUrl(provider);
    if (!apiUrl) {
        const err = new Error(`missing API url for ${provider}`);
        err.code = 'NO_API_URL';
        throw err;
    }

    const convMessages = convertMessages(messages, systemPrompt);
    const requestBody = {
        model,
        messages: convMessages,
        max_tokens: maxTokens || config.llmMaxTokens,
        temperature: temperature ?? config.llmTemperature,
        stream: Boolean(stream),
    };
    if (stopSequences?.length) requestBody.stop = stopSequences;
    if (stream) requestBody.stream_options = { include_usage: true };

    log(`Sampling: calling ${provider} model=${model} messages=${convMessages.length} stream=${Boolean(stream)}`);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${errText}`);
    }

    let text;
    let actualModel;
    let finishReason;
    let usage;

    if (requestBody.stream) {
        const acc = await readSse(response);
        text = acc.text;
        actualModel = acc.model || model;
        finishReason = acc.finishReason || 'stop';
        usage = acc.usage;
    } else {
        const data = await response.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('No choices in API response');
        text = choice.message?.content || '';
        actualModel = data.model || model;
        finishReason = choice.finish_reason || 'endTurn';
        usage = data.usage || null;
    }

    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens
        ?? estimateTokens(convMessages.map((m) => m.content).join('\n'));
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens
        ?? estimateTokens(text);
    recordUsage({ provider, model: actualModel, inputTokens, outputTokens });

    return {
        model: actualModel,
        role: 'assistant',
        content: { type: 'text', text },
        stopReason: finishReason === 'stop' ? 'endTurn'
            : finishReason === 'length' ? 'maxTokens'
            : finishReason || 'endTurn',
        usage: { inputTokens, outputTokens },
    };
}

/**
 * Sampling（服务端调用 LLM）。默认非流式；传 stream:true 或配置 LLM_STREAM=true 开启 SSE。
 * 配置 SAMPLING_PROVIDERS=vllm,deepseek,openai 时按顺序降级，全部失败再回退 echo。
 */
export async function createSamplingMessage(params) {
    const { messages, systemPrompt, maxTokens, temperature, stopSequences, modelPreferences } = params;
    const model = modelPreferences?.hints?.[0]?.name || config.llmModel;
    const stream = Boolean(params.stream || config.llmStream);

    const chain = parseProviderList();
    const providers = chain.length > 0
        ? chain
        : [detectProvider(config.llmApiUrl)];

    if (chain.length === 0 && !getApiKey(providers[0])) {
        log('Sampling: no API key configured, returning echo response');
        return echoResponse(messages);
    }

    const errors = [];
    for (const provider of providers) {
        try {
            return await callProvider({
                provider, model, messages, systemPrompt, maxTokens, temperature, stopSequences, stream,
            });
        } catch (e) {
            errors.push(`${provider}: ${e.message}`);
            if (chain.length > 0) {
                log(`Sampling: ${provider} 失败，尝试下一个（${e.message}）`);
                continue;
            }
            // 未配置降级链时保持旧行为：直接抛出
            logError(`Sampling error: ${e.message}`);
            throw e;
        }
    }

    logError(`Sampling error: all providers failed (${errors.join('; ')})`);
    try {
        metrics.increment('sampling_requests_total', { provider: 'none', model, status: 'failed' });
    } catch { /* 指标失败不影响主流程 */ }
    log('Sampling: all providers failed, returning echo response');
    return echoResponse(messages);
}
