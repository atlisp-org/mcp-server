import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function findEntitiesNearPoint(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ss (ssget "_CP"
                (list
                    (polar (list ${params.point}) 0 ${params.radius})
                    (polar (list ${params.point}) (* pi 0.5) ${params.radius})
                    (polar (list ${params.point}) pi ${params.radius})
                    (polar (list ${params.point}) (* pi 1.5) ${params.radius})
                )))
                (progn
                    (setq cnt (sslength ss) handles nil i 0)
                    (while (< i cnt)
                        (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                        (setq i (1+ i)))
                    (reverse handles)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: `在 ${params.point} 半径 ${params.radius} 范围内未找到实体` }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function findEntitiesInWindow(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ss (ssget "_W" (list ${params.corner1}) (list ${params.corner2})))
                (progn
                    (setq cnt (sslength ss) handles nil i 0)
                    (while (< i cnt)
                        (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                        (setq i (1+ i)))
                    (reverse handles)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '窗口内未找到实体' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function findEntitiesCrossing(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ss (ssget "_C" (list ${params.corner1}) (list ${params.corner2})))
                (progn
                    (setq cnt (sslength ss) handles nil i 0)
                    (while (< i cnt)
                        (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                        (setq i (1+ i)))
                    (reverse handles)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '交叉窗口内未找到实体' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function findEntitiesIntersecting(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pts = params.fencePoints.split(/\s+/).filter(Boolean);
        const ptListCode = pts.map(p => `(list ${p})`).join(' ');
        const code = `(progn
            (vl-load-com)
            (if (setq ss (ssget "_F" (list ${ptListCode})))
                (progn
                    (setq cnt (sslength ss) handles nil i 0)
                    (while (< i cnt)
                        (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                        (setq i (1+ i)))
                    (reverse handles)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '栏选线未找到相交实体' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function findEntitiesInPolygon(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pts = params.points.split(/\s+/).filter(Boolean);
        const ptListCode = pts.map(p => `(list ${p})`).join(' ');
        const code = `(progn
            (vl-load-com)
            (if (setq ss (ssget "_WP" (list ${ptListCode})))
                (progn
                    (setq cnt (sslength ss) handles nil i 0)
                    (while (< i cnt)
                        (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                        (setq i (1+ i)))
                    (reverse handles)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '多边形内未找到实体' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getBoundingBox(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (vla-getboundingbox (vlax-ename->vla-object ent) 'll 'ur)
                    (list
                        (vlax-safearray->list ll)
                        (vlax-safearray->list ur)
                    )
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'NOTFOUND' || result === '"NOTFOUND"') {
            return { content: [{ type: 'text', text: `未找到实体: ${params.handle}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `包围盒: ${result}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
