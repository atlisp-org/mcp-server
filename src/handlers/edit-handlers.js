import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function trimEntity(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent1 (handent "${escapeLispString(params.handle)}"))
                (if (setq ent2 (handent "${escapeLispString(params.cuttingEdgeHandle)}"))
                    (progn (command "_.TRIM" ent2 "" ent1 "" "") "OK")
                    "CUT_EDGE_NOT_FOUND"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已修剪实体: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `修剪失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function extendEntity(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent1 (handent "${escapeLispString(params.handle)}"))
                (if (setq ent2 (handent "${escapeLispString(params.boundaryHandle)}"))
                    (progn (command "_.EXTEND" ent2 "" ent1 "") "OK")
                    "BOUNDARY_NOT_FOUND"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已延伸实体: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `延伸失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function fillet(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (and (setq ent1 (handent "${escapeLispString(params.handle1)}"))
                     (setq ent2 (handent "${escapeLispString(params.handle2)}")))
                (progn
                    (command "_.FILLET" "R" ${params.radius} "_.FILLET" ent1 ent2)
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已圆角连接实体，半径=${params.radius}` }] };
        }
        return { content: [{ type: 'text', text: `圆角失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function chamfer(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (and (setq ent1 (handent "${escapeLispString(params.handle1)}"))
                     (setq ent2 (handent "${escapeLispString(params.handle2)}")))
                (progn
                    (command "_.CHAMFER" "D" ${params.distance1} ${params.distance2} "_.CHAMFER" ent1 ent2)
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已倒角连接实体，距离=${params.distance1},${params.distance2}` }] };
        }
        return { content: [{ type: 'text', text: `倒角失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function breakEntity(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (command "_.BREAK" ent "${escapeLispString(params.point1)}" "${escapeLispString(params.point2)}")
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已打断实体: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `打断失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function joinEntities(params) {
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
            (if (> (sslength ss) 1)
                (progn (command "_.JOIN" ss "") "OK")
                "TOO_FEW"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已合并 ${params.handles.length} 个实体` }] };
        }
        return { content: [{ type: 'text', text: `合并失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function stretch(params) {
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
                (progn
                    (command "_.STRETCH" ss "" "${escapeLispString(params.basePoint)}" "${escapeLispString(params.displacement)}")
                    "OK"
                )
                "NO_ENTITIES"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已拉伸 ${params.handles.length} 个实体` }] };
        }
        return { content: [{ type: 'text', text: `拉伸失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
