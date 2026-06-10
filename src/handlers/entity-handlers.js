import { cad } from '../cad.js';
import { log } from '../logger.js';
import { escapeLispString } from '../handler-utils.js';

export async function getEntity(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (setq ed (entget ent))
                (list
                    "type" (cdr (assoc 0 ed))
                    "handle" (cdr (assoc 5 ed))
                    "layer" (cdr (assoc 8 ed))
                    "color" (if (assoc 62 ed) (cdr (assoc 62 ed)) 256)
                    "linetype" (if (assoc 6 ed) (cdr (assoc 6 ed)) "ByLayer")
                    "elevation" (if (assoc 38 ed) (cdr (assoc 38 ed)) 0.0)
                )
            )
            nil
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: `未找到实体: ${handle}` }], isError: true };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setEntityProperty(handle, property, value) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    let propCode = '';
    switch (property) {
        case 'layer':
            propCode = `(cons 8 "${escapeLispString(value)}")`;
            break;
        case 'color':
            propCode = `(cons 62 ${isNaN(Number(value)) ? 256 : Number(value)})`;
            break;
        case 'linetype':
            propCode = `(cons 6 "${escapeLispString(value)}")`;
            break;
        case 'elevation':
            propCode = `(cons 38 ${isNaN(Number(value)) ? 0 : Number(value)})`;
            break;
        default:
            return { content: [{ type: 'text', text: `不支持的属性: ${property}` }], isError: true };
    }

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (setq ed (entget ent))
                (entmod (append ed (list ${propCode})))
                "OK"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置实体 ${handle} 的 ${property} 为 ${value}` }] };
        }
        return { content: [{ type: 'text', text: `操作失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function deleteEntity(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (entdel ent)
                "DELETED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'DELETED' || result === '"DELETED"') {
            return { content: [{ type: 'text', text: `已删除实体: ${handle}` }] };
        }
        return { content: [{ type: 'text', text: `删除失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function selectEntities(filter) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    let filterCode = 'nil';
    if (filter && (filter.type || filter.layer)) {
        const items = [];
        if (filter.type) items.push(`'(0 . "${escapeLispString(filter.type)}")`);
        if (filter.layer) items.push(`'(8 . "${escapeLispString(filter.layer)}")`);
        filterCode = `(list ${items.join(' ')})`;
    }

    const code = `(progn
        (vl-load-com)
        (if (setq ss (ssget "X" ${filterCode}))
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
    try {
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '未找到符合条件的实体' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
export async function bringToFront(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_F")\n`);
        return { content: [{ type: 'text', text: `已置于最前: ${handle}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function sendToBack(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_B")\n`);
        return { content: [{ type: 'text', text: `已置于最后: ${handle}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function bringAbove(handle, referenceHandle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_A" (handent "${escapeLispString(referenceHandle)}"))\n`);
        return { content: [{ type: 'text', text: `已置于 ${referenceHandle} 之上` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function sendBelow(handle, referenceHandle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_U" (handent "${escapeLispString(referenceHandle)}"))\n`);
        return { content: [{ type: 'text', text: `已置于 ${referenceHandle} 之下` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function selectAll() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult('(progn (setq ss (ssget "_X")) (setq handles nil) (setq i 0) (if ss (repeat (sslength ss) (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles)) (setq i (1+ i)))) (vl-prin1-to-string (reverse handles)))');
        return { content: [{ type: 'text', text: result || '[]' }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function selectLast() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult('(vl-princ-to-string (list (cdr (assoc 5 (entget (entlast))))))');
        return { content: [{ type: 'text', text: result || 'nil' }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function selectByColor(colorIndex) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult(`(progn (setq ss (ssget "_X" (list (cons 62 ${colorIndex})))) (setq handles nil) (setq i 0) (if ss (repeat (sslength ss) (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles)) (setq i (1+ i)))) (vl-prin1-to-string (reverse handles)))`);
        return { content: [{ type: 'text', text: result || '[]' }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}