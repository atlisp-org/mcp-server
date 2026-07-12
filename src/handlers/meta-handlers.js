import { tools } from '../tools/index.js';
import { listPrompts, getPrompt } from './prompt-handlers.js';

export async function search_tools(a) {
    const q = (a.query || '').toLowerCase();
    const results = tools.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    const text = results.length ? `找到 ${results.length} 个工具:\n${results.map(t => `${t.name}: ${t.description}`).join('\n')}` : `未找到包含 "${a.query}" 的工具`;
    return { content: [{ type: 'text', text }] };
}

export async function list_tools_by_category(a) {
    const categories = {};
    for (const t of tools) {
        const cat = t.annotations?.category || '其他';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(t.name);
    }
    if (a.category) {
        const names = categories[a.category];
        return { content: [{ type: 'text', text: names ? `${a.category} (${names.length}):\n${names.join('\n')}` : `未找到分类: ${a.category}` }] };
    }
    const lines = [];
    for (const [cat, names] of Object.entries(categories)) {
        lines.push(`## ${cat} (${names.length})`);
    }
    lines.push(`\n共 ${Object.keys(categories).length} 个分类`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function get_tool_info(a) {
    if (!a.name) return { content: [{ type: 'text', text: '需要 name 参数（工具名称）' }], isError: true };
    const tool = tools.find(t => t.name === a.name);
    if (!tool) return { content: [{ type: 'text', text: `未找到工具: ${a.name}` }], isError: true };

    const ann = tool.annotations || {};
    const required = (tool.inputSchema?.required || []).join(', ') || '无';
    const props = tool.inputSchema?.properties || {};
    const params = Object.entries(props).map(([k, v]) => {
        const req = required.includes(k) ? '必填' : '可选';
        const desc = v.description || '';
        return `  ${k} (${req}): ${desc}`;
    }).join('\n');

    const lines = [
        `## ${tool.name}`,
        `描述: ${tool.description || '无'}`,
        `分类: ${ann.category || '其他'}`,
        `只读: ${ann.readOnlyHint ? '是' : '否'}`,
        `破坏性: ${ann.destructiveHint ? '是' : '否'}`,
        `幂等: ${ann.idempotentHint ? '是' : '否'}`,
        `开放世界: ${ann.openWorldHint ? '是' : '否'}`,
        ``,
        `参数:`,
        params || '  无参数',
    ];
    if (ann.deprecatedReason) {
        lines.push(`\n已弃用: ${ann.deprecatedReason}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function list_prompts_handler() {
    const prompts = await listPrompts();
    return { content: [{ type: 'text', text: JSON.stringify(prompts) }] };
}

export async function get_prompt_handler(a) {
    const prompt = await getPrompt(a.name, a.args || {});
    return { content: prompt.messages.map(m => ({ type: 'text', text: m.content.text || m.content })) };
}
