import { tools } from '../tools/index.js';
import { getAuditStats } from '../audit-log.js';
import { computeEffectivePriority, sortByPriorityUsage } from '../tools/params-utils.js';
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

    const usage = getUsageCounts();
    const usageCount = usage[tool.name] ?? 0;
    const eff = computeEffectivePriority(ann.priority || 'common', usageCount);
    const prioText = `${ann.priority || 'common'}${ann.priority === 'core' ? '（核心高频）' : ann.priority === 'rare' ? '（低频专业）' : '（常规）'}`;
    const dynText = eff.priority !== (ann.priority || 'common')
        ? `（动态调档→${eff.priority}${eff.hot ? '·热' : ''}）`
        : eff.hot ? '（动态热↑）' : '';

    const lines = [
        `## ${tool.name}`,
        `描述: ${tool.description || '无'}`,
        `分类: ${ann.category || '其他'}`,
        `行业: ${(ann.industry || []).join('、')}`,
        `优先级: ${prioText}${dynText}`,
        `实际调用: ${usageCount}次`,
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

function getUsageCounts() {
    try {
        const stats = getAuditStats();
        return stats?.tools || {};
    } catch {
        return {};
    }
}

function oneLineDesc(t) {
    const d = (t.description || '').split('\n')[0];
    return d.replace(/【类别】.*$/, '').trim();
}

export async function list_tools_by_industry(a) {
    const usage = getUsageCounts();
    const byIndustry = {};
    for (const t of tools) {
        const inds = t.annotations?.industry || ['通用'];
        for (const ind of inds) {
            if (!byIndustry[ind]) byIndustry[ind] = [];
            byIndustry[ind].push(t);
        }
    }
    if (a.industry) {
        const list = byIndustry[a.industry];
        if (!list) return { content: [{ type: 'text', text: `未找到行业: ${a.industry}` }], isError: true };
        const eff = t => computeEffectivePriority(t.annotations?.priority || 'common', usage[t.name] ?? 0);
        const sorted = sortByPriorityUsage(list, t => eff(t).priority, t => usage[t.name] ?? 0);
        const lines = sorted.map(t => {
            const p = eff(t);
            const mark = p.priority === 'core' ? (p.hot ? '[核心·热]' : '[核心]') : p.priority === 'rare' ? '[低频]' : '';
            const count = usage[t.name] ?? 0;
            return `${t.name} ${mark} (${count}次): ${oneLineDesc(t)}`;
        });
        return { content: [{ type: 'text', text: `## 行业「${a.industry}」(${list.length} 个工具)\n${lines.join('\n')}` }] };
    }
    const lines = [];
    for (const [ind, list] of Object.entries(byIndustry)) {
        lines.push(`## ${ind} (${list.length})`);
    }
    lines.push(`\n共 ${Object.keys(byIndustry).length} 个行业`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function list_tools_by_priority(a) {
    const usage = getUsageCounts();
    const tiers = { core: [], common: [], rare: [] };
    for (const t of tools) {
        const p = t.annotations?.priority || 'common';
        if (tiers[p]) tiers[p].push(t);
    }
    if (a.priority) {
        const staticList = tiers[a.priority] || [];
        if (!staticList.length && !tiers[a.priority]) return { content: [{ type: 'text', text: `无效优先级: ${a.priority}（可选 core/common/rare）` }], isError: true };
        const label = a.priority === 'core' ? '静态核心高频' : a.priority === 'rare' ? '静态低频专业' : '静态常规';
        const sorted = sortByPriorityUsage(staticList, t => t.annotations?.priority || 'common', t => usage[t.name] ?? 0);
        const lines = sorted.map(t => {
            const count = usage[t.name] ?? 0;
            const eff = computeEffectivePriority(t.annotations?.priority || 'common', count);
            const hot = eff.hot ? ' [热↑]' : '';
            const unused = count === 0 ? '（未使用）' : '';
            return `${t.name} (${count}次)${hot}${unused}: ${oneLineDesc(t)}`;
        });
        return { content: [{ type: 'text', text: `## ${label} (${staticList.length} 个工具)\n${lines.join('\n')}` }] };
    }
    const lines = [];
    const effCounts = { core: 0, common: 0, rare: 0 };
    for (const t of tools) {
        const p = computeEffectivePriority(t.annotations?.priority || 'common', usage[t.name] ?? 0).priority;
        effCounts[p]++;
    }
    for (const [tier, list] of Object.entries(tiers)) {
        const label = tier === 'core' ? '静态核心高频' : tier === 'rare' ? '静态低频专业' : '静态常规';
        lines.push(`## ${label} (${list.length})${effCounts[tier] !== list.length ? ` | 动态有效: ${effCounts[tier]}` : ''}`);
    }
    lines.push(`\n共 ${Object.keys(tiers).length} 个静态档位 | 动态: 核心${effCounts.core}/常规${effCounts.common}/低频${effCounts.rare}`);
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
