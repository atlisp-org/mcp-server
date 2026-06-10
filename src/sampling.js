import config from './config.js';
import { log, error as logError } from './logger.js';

const PROVIDER_MAP = {
    'openai': { url: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY' },
    'deepseek': { url: 'https://api.deepseek.com/v1/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
    'vllm': { url: '', keyEnv: '' },
};

function detectProvider(url) {
    if (url.includes('openai')) return 'openai';
    if (url.includes('deepseek')) return 'deepseek';
    return 'custom';
}

function getApiKey(provider) {
    if (config.llmApiKey) return config.llmApiKey;
    const map = PROVIDER_MAP[provider];
    if (map?.keyEnv && process.env[map.keyEnv]) return process.env[map.keyEnv];
    return '';
}

function getApiUrl(provider) {
    if (config.llmApiUrl) return config.llmApiUrl;
    const map = PROVIDER_MAP[provider];
    return map?.url || '';
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

export async function createSamplingMessage(params) {
    const { messages, systemPrompt, maxTokens, temperature, stopSequences, modelPreferences } = params;

    const provider = detectProvider(config.llmApiUrl);
    const apiKey = getApiKey(provider);
    const apiUrl = getApiUrl(provider);
    const model = modelPreferences?.hints?.[0]?.name || config.llmModel;

    if (!apiKey) {
        log('Sampling: no API key configured, returning echo response');
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

    const convMessages = convertMessages(messages, systemPrompt);
    const requestBody = {
        model,
        messages: convMessages,
        max_tokens: maxTokens || config.llmMaxTokens,
        temperature: temperature ?? config.llmTemperature,
        stream: false,
    };
    if (stopSequences?.length) {
        requestBody.stop = stopSequences;
    }

    log(`Sampling: calling ${provider} model=${model} messages=${convMessages.length}`);

    try {
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

        const data = await response.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('No choices in API response');

        return {
            model: data.model || model,
            role: 'assistant',
            content: { type: 'text', text: choice.message?.content || '' },
            stopReason: choice.finish_reason === 'stop' ? 'endTurn'
                : choice.finish_reason === 'length' ? 'maxTokens'
                : choice.finish_reason || 'endTurn',
        };
    } catch (e) {
        logError(`Sampling error: ${e.message}`);
        throw e;
    }
}
