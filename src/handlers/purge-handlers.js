import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function purgeAll(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn (command "_.PURGE" "A" "" "N") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: '已清理所有未使用项' }] };
        }
        return { content: [{ type: 'text', text: `清理失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function purgeBlocks(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pattern = params.namePattern || '*';
        const code = `(progn (command "_.PURGE" "B" "${escapeLispString(pattern)}" "N") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已清理未使用的块: ${pattern}` }] };
        }
        return { content: [{ type: 'text', text: `清理失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function purgeLayers(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pattern = params.namePattern || '*';
        const code = `(progn (command "_.PURGE" "LA" "${escapeLispString(pattern)}" "N") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已清理未使用的图层: ${pattern}` }] };
        }
        return { content: [{ type: 'text', text: `清理失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function purgeStyles(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pattern = params.namePattern || '*';
        const code = `(progn (command "_.PURGE" "ST" "${escapeLispString(pattern)}" "N") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已清理未使用的样式: ${pattern}` }] };
        }
        return { content: [{ type: 'text', text: `清理失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function purgeRegisteredApps(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pattern = params.namePattern || '*';
        const code = `(progn (command "_.PURGE" "R" "${escapeLispString(pattern)}" "N") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已清理未注册的应用程序: ${pattern}` }] };
        }
        return { content: [{ type: 'text', text: `清理失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawingAudit(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn (command "_.AUDIT" "Y") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: '图形审计完成，已修复所有错误' }] };
        }
        return { content: [{ type: 'text', text: `审计失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawingRecover(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn (command "_.RECOVER" "${escapeLispString(params.filePath)}") "OK")`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已恢复文件: ${params.filePath}` }] };
        }
        return { content: [{ type: 'text', text: `恢复失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function overkill(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const handleList = params.handles
            .map(h => `(setq ss (ssadd (handent "${escapeLispString(h)}") ss))`)
            .join('\n');
        const code = `(progn
            (vl-load-com)
            (setq ss (ssadd))
            ${handleList}
            (if (> (sslength ss) 0)
                (progn (command "_.OVERKILL" ss "" "") "OK")
                "NO_ENTITIES"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已删除 ${params.handles.length} 个实体中的重复几何图形` }] };
        }
        return { content: [{ type: 'text', text: `删除重复实体失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
