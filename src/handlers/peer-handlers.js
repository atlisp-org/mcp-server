import peerManager from '../peer-manager.js';
import peerProxy from '../peer-proxy.js';

export async function peer_list() {
    const peers = peerManager.getPeers();
    if (!peers.length) {
        return { content: [{ type: 'text', text: '未发现任何 peer 服务器。使用 peer_scan 扫描局域网。' }] };
    }

    const lines = peers.map(p => {
        const status = p.healthy ? '✓ 健康' : '✗ 离线';
        const lastSeen = Math.round((Date.now() - p.lastSeen) / 1000);
        return `  ${p.id} - ${p.hostname} (${p.url}) v${p.version} [${status}] ${lastSeen}s前`;
    });

    return { content: [{ type: 'text', text: `已发现 ${peers.length} 个 peer:\n${lines.join('\n')}` }] };
}

export async function peer_scan(a) {
    const found = await peerManager.scanLan({
        port: a.port,
        timeoutMs: a.timeout,
        maxHosts: a.maxHosts,
    });

    if (!found.length) {
        return { content: [{ type: 'text', text: '未发现新的 MCP 服务器。' }] };
    }

    const lines = found.map(f => {
        const info = f.serverInfo ? ` [${f.serverInfo.name} v${f.serverInfo.version}]` : '';
        return `  ${f.ip}:${f.port}${info}`;
    });

    return { content: [{ type: 'text', text: `扫描完成，发现 ${found.length} 个 MCP 服务器:\n${lines.join('\n')}` }] };
}

export async function peer_connect(a) {
    const peer = peerManager.addPeer(a.host, a.port || 8110, {
        apikey: a.apikey,
    });

    return { content: [{ type: 'text', text: `已添加 peer: ${peer.hostname} (${peer.url})\n状态: ${peer.healthy ? '可达' : '探测中...'}` }] };
}

export async function peer_disconnect(a) {
    const removed = peerManager.removePeer(a.peerId);
    if (removed) {
        return { content: [{ type: 'text', text: `已断开 peer: ${a.peerId}` }] };
    }
    return { content: [{ type: 'text', text: `未找到 peer: ${a.peerId}` }], isError: true };
}

export async function peer_forward(a) {
    try {
        const result = await peerProxy.forwardEvalLisp(a.peerId, a.code, {
            encoding: a.encoding,
        });

        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text: `远程执行结果:\n${text}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `远程执行失败: ${e.message}` }], isError: true };
    }
}

export async function peer_cad_info(a) {
    try {
        const result = await peerProxy.getPeerCadInfo(a.peerId);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text: `远程 CAD 信息:\n${text}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `获取远程 CAD 信息失败: ${e.message}` }], isError: true };
    }
}

export async function peer_cad_pool(a) {
    try {
        const result = await peerProxy.getPeerCadPool(a.peerId);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text: `远程连接池信息:\n${text}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `获取远程连接池信息失败: ${e.message}` }], isError: true };
    }
}

export async function peer_stats() {
    const stats = peerManager.getStats();
    const lines = [
        `Peer 统计:`,
        `  总数: ${stats.total}`,
        `  健康: ${stats.healthy}`,
        `  已连接: ${stats.connected}`,
        '',
        '详细列表:',
    ];

    for (const p of stats.peers) {
        const lastSeen = Math.round(p.lastSeenAgo / 1000);
        lines.push(`  ${p.id} - ${p.hostname} (${p.url}) v${p.version} [${p.healthy ? '健康' : '离线'}] ${lastSeen}s前`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function callRemoteTool(ip, port, toolName, args = {}) {
    const url = `http://${ip}:${port}/mcp`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: toolName, arguments: args }
        })
    });
    const data = await res.json();
    return data.result || data.error;
}

export async function peer_summary(a) {
    const port = a.port || 8110;
    const timeout = a.timeout || 1000;

    const found = await peerManager.scanLan({ port, timeoutMs: timeout, maxHosts: 254 });

    if (!found.length) {
        return { content: [{ type: 'text', text: '未发现任何 MCP 服务器。' }] };
    }

    const documents = [];
    const errors = [];

    for (const f of found) {
        try {
            const cadInfo = await callRemoteTool(f.ip, f.port, 'get_cad_info');
            const infoText = cadInfo.content?.[0]?.text || '';

            if (!infoText.includes('Connected')) {
                errors.push(`${f.ip}: CAD 未连接`);
                continue;
            }

            const docResult = await callRemoteTool(f.ip, f.port, 'eval_lisp_with_result', {
                code: '(list (getvar "DWGNAME") (getvar "DWGPREFIX") (getvar "CLAYER"))'
            });

            const docText = docResult.content?.[0]?.text || '';
            const match = docText.match(/\(([^)]+)\)/);

            if (match) {
                const parts = match[1].split(' ');
                documents.push({
                    host: f.ip,
                    platform: infoText.match(/Platform: ([^,]+)/)?.[1] || 'Unknown',
                    version: infoText.match(/Version: ([^,]+)/)?.[1] || 'Unknown',
                    docName: parts[0] || 'Unknown',
                    docPath: parts[1] || 'Unknown',
                    currentLayer: parts[2] || 'Unknown'
                });
            }
        } catch (e) {
            errors.push(`${f.ip}: ${e.message}`);
        }
    }

    const lines = [
        '========================================',
        '       局域网 CAD 文档汇总',
        '========================================',
        '',
        `发现 ${documents.length} 个文档:`,
        '',
    ];

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        lines.push(`${i + 1}. ${doc.docName}`);
        lines.push(`   主机: ${doc.host}`);
        lines.push(`   平台: ${doc.platform} ${doc.version}`);
        lines.push(`   路径: ${doc.docPath}`);
        lines.push(`   图层: ${doc.currentLayer}`);
        lines.push('');
    }

    if (errors.length > 0) {
        lines.push('错误:');
        errors.forEach(e => lines.push(`  - ${e}`));
        lines.push('');
    }

    lines.push('========================================');
    lines.push(`时间: ${new Date().toLocaleString('zh-CN')}`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };
}
