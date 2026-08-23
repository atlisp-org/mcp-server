import fs from 'fs';
import { error as logError } from '../logger.js';
import path from 'path';
import os from 'os';

const SKILLS_DIR = path.join(os.homedir(), '.atlisp', 'skills');
const REGISTRY_URL = process.env.SKILL_REGISTRY_URL || 'https://raw.githubusercontent.com/atlisp/skill-registry/main/index.json';
const CACHE_PATH = path.join(os.homedir(), '.atlisp', 'skill-registry-cache.json');

function readCache() {
    try { if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch (e) { logError(`skill 缓存读取失败: ${e.message}`); }
    return null;
}

function writeCache(data) {
    try { fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { logError(`skill 缓存写入失败: ${e.message}`); }
}

async function fetchIndex() {
    let index = readCache();
    if (index && (Date.now() - index.fetchedAt < 3600000)) return index;
    try {
        const resp = await fetch(REGISTRY_URL, { headers: { 'User-Agent': 'atlisp-mcp' } });
        if (resp.ok) {
            index = await resp.json();
            index.fetchedAt = Date.now();
            writeCache(index);
        }
    } catch (e) { logError(`skill 索引刷新失败: ${e.message}`); }
    return index;
}

export async function skill_search(a) {
    const index = await fetchIndex();
    if (!index?.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
    const q = (a.query || '').toLowerCase();
    const results = index.skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q))
    );
    if (!results.length) return { content: [{ type: 'text', text: `未找到匹配 "${a.query}" 的 skill` }] };
    const lines = [`找到 ${results.length} 个 skill:\n`];
    for (const s of results) {
        lines.push(`**${s.name}**`);
        if (s.description) lines.push(`  描述: ${s.description}`);
        if (s.tags?.length) lines.push(`  标签: ${s.tags.join(', ')}`);
        if (s.version) lines.push(`  版本: ${s.version}`);
        lines.push('');
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function skill_install(a) {
    if (!a.name) return { content: [{ type: 'text', text: '需要 skill 名称' }], isError: true };
    const index = await fetchIndex();
    if (!index?.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
    const skill = index.skills.find(s => s.name === a.name);
    if (!skill) return { content: [{ type: 'text', text: `未找到 skill: ${a.name}` }], isError: true };
    const downloadUrl = skill.download_url || skill.url;
    if (!downloadUrl) return { content: [{ type: 'text', text: `Skill "${a.name}" 没有下载地址` }], isError: true };
    let content;
    try {
        const resp = await fetch(downloadUrl, { headers: { 'User-Agent': 'atlisp-mcp' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        content = await resp.text();
    } catch (e) {
        return { content: [{ type: 'text', text: `下载失败: ${e.message}` }], isError: true };
    }
    try { fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch (e) { logError(`创建 skills 目录失败: ${e.message}`); }
    const safeName = a.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').substring(0, 40);
    const skillFile = path.join(SKILLS_DIR, `skill-${safeName}.md`);
    if (fs.existsSync(skillFile)) {
        return { content: [{ type: 'text', text: `Skill "${a.name}" 已安装 (${skillFile})` }], isError: true };
    }
    let finalContent = content;
    if (!content.match(/^---\n/)) {
        const tags = (skill.tags || []).join(', ');
        finalContent = `---\nname: ${a.name}\ndescription: ${skill.description || ''}\ntags: ${tags}\n---\n\n${content}`;
    }
    fs.writeFileSync(skillFile, finalContent, 'utf-8');
    return { content: [{ type: 'text', text: `${skill.name} 安装成功\n文件: ${skillFile}${skill.version ? `\n版本: ${skill.version}` : ''}` }] };
}

export async function skill_list_installed() {
    if (!fs.existsSync(SKILLS_DIR)) return { content: [{ type: 'text', text: '暂无已安装的 skill' }] };
    const results = [];
    try {
        const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
                const fullPath = path.join(SKILLS_DIR, entry.name);
                try {
                    const raw = fs.readFileSync(fullPath, 'utf-8');
                    const match = raw.match(/^---\n([\s\S]*?)\n---/);
                    if (match) {
                        const fm = {};
                        for (const line of match[1].split('\n')) {
                            const sep = line.indexOf(':');
                            if (sep > 0) fm[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
                        }
                        results.push({ name: fm.name || entry.name.replace('.md', ''), description: fm.description || '', tags: fm.tags || '' });
                    } else {
                        results.push({ name: entry.name.replace('.md', ''), description: '', tags: '' });
                    }
                } catch (e) { logError(`读取 skill 描述失败: ${e.message}`); }
            }
        }
    } catch (e) { logError(`扫描 skills 目录失败: ${e.message}`); }
    if (!results.length) return { content: [{ type: 'text', text: '暂无已安装的 skill' }] };
    const lines = [`已安装 ${results.length} 个 skill:\n`];
    for (const s of results) {
        lines.push(`**${s.name}**${s.description ? ` — ${s.description}` : ''}`);
        if (s.tags) lines.push(`  标签: ${s.tags}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function skill_uninstall(a) {
    if (!a.name) return { content: [{ type: 'text', text: '需要 skill 名称' }], isError: true };
    if (!fs.existsSync(SKILLS_DIR)) return { content: [{ type: 'text', text: `未安装 skill: ${a.name}` }], isError: true };
    let found = null;
    try {
        const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
                const fullPath = path.join(SKILLS_DIR, entry.name);
                try {
                    const raw = fs.readFileSync(fullPath, 'utf-8');
                    const match = raw.match(/^---\n([\s\S]*?)\n---/);
                    if (match) {
                        for (const line of match[1].split('\n')) {
                            if (line.startsWith('name:') && line.slice(5).trim() === a.name) { found = fullPath; break; }
                        }
                    } else if (entry.name.replace('.md', '') === a.name) { found = fullPath; }
                } catch (e) { logError(`匹配 skill 文件失败: ${e.message}`); }
                if (found) break;
            }
        }
    } catch (e) { logError(`扫描 skills 目录失败: ${e.message}`); }
    if (!found) return { content: [{ type: 'text', text: `未安装 skill: ${a.name}` }], isError: true };
    fs.unlinkSync(found);
    return { content: [{ type: 'text', text: `${a.name} 已卸载` }] };
}

export async function skill_list_categories() {
    const index = await fetchIndex();
    if (!index?.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
    const cats = new Set();
    for (const s of index.skills) for (const t of (s.tags || [])) cats.add(t);
    const sorted = Array.from(cats).sort();
    return { content: [{ type: 'text', text: sorted.length ? `注册表分类 (${sorted.length}):\n${sorted.join('\n')}` : '暂无分类' }] };
}
