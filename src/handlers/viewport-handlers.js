import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function createViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (setvar "CTAB" "${escapeLispString(params.layout)}")
            (command "_.MVIEW" "${escapeLispString(params.corner1)}" "${escapeLispString(params.corner2)}")
            (entlast)
        )`;
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: `已在布局 ${params.layout} 创建视口，句柄: ${result}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function createPolygonalViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pts = params.points.split(/\s+/).filter(Boolean);
        const pointArgs = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
        const code = `(progn
            (vl-load-com)
            (setvar "CTAB" "${escapeLispString(params.layout)}")
            (command "_.MVIEW" "P" ${pointArgs} "C")
            (entlast)
        )`;
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: `已在布局 ${params.layout} 创建多边形视口，句柄: ${result}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setViewportScale(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq vp (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setvar "CVPORT" (cdr (assoc 69 (entget vp))))
                    (command "_.ZOOM" (strcat (rtos (/ 1.0 ${params.scale}) 2 8) "XP"))
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置视口比例: 1:${params.scale}` }] };
        }
        return { content: [{ type: 'text', text: `设置比例失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function lockViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq vp (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setq ed (entget vp))
                    (entmod (subst '(90 . 16384) (assoc 90 ed) ed))
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已锁定视口: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `锁定视口失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function unlockViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq vp (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setq ed (entget vp))
                    (setq val (cdr (assoc 90 ed)))
                    (entmod (subst (cons 90 (logand val (~ 16384))) (assoc 90 ed) ed))
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已解锁视口: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `解锁视口失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function maximizeViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq vp (handent "${escapeLispString(params.handle)}"))
                (progn
                    (command "_.VPMAX" vp)
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已最大化视口: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `最大化视口失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function minimizeViewport(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.VPMIN")`;
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: '已最小化视口' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
