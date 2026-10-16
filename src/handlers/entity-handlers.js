import { cad } from '../cad.js';
import { withCadConnection, mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';
import { entityBasicStructured, stringListStructured } from './structured-output.js';

export const getEntity = withCadConnection(async (handle) => {
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
    const result = await cad.sendCommandWithResult(code);
    if (!result || result === 'nil') {
        return mcpError(`未找到实体: ${handle}`);
    }
    return { ...mcpSuccess(result), structuredContent: entityBasicStructured(result) };
});

export const setEntityProperty = withCadConnection(async (handle, property, value) => {
    let propCode;
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
            return mcpError(`不支持的属性: ${property}`);
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
    const result = await cad.sendCommandWithResult(code);
    if (result === 'OK' || result === '"OK"') {
        return mcpSuccess(`已设置实体 ${handle} 的 ${property} 为 ${value}`);
    }
    return mcpError(`操作失败: ${result}`);
});

export const deleteEntity = withCadConnection(async (handle) => {
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
    const result = await cad.sendCommandWithResult(code);
    if (result === 'DELETED' || result === '"DELETED"') {
        return mcpSuccess(`已删除实体: ${handle}`);
    }
    return mcpError(`删除失败: ${result}`);
});

export const selectEntities = withCadConnection(async (filter) => {
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
    const result = await cad.sendCommandWithResult(code);
    if (!result || result === 'nil') {
        return { ...mcpSuccess('未找到符合条件的实体'), structuredContent: stringListStructured('未找到符合条件的实体', 'handles') };
    }
    return { ...mcpSuccess(result), structuredContent: stringListStructured(result, 'handles') };
});

export const bringToFrontEntity = withCadConnection(async (handle) => {
    await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_F")\n`);
    return mcpSuccess(`已置于最前: ${handle}`);
});

export const sendToBackEntity = withCadConnection(async (handle) => {
    await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_B")\n`);
    return mcpSuccess(`已置于最后: ${handle}`);
});

export const bringAboveEntity = withCadConnection(async (handle, referenceHandle) => {
    await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_A" (handent "${escapeLispString(referenceHandle)}"))\n`);
    return mcpSuccess(`已置于 ${referenceHandle} 之上`);
});

export const sendBelowEntity = withCadConnection(async (handle, referenceHandle) => {
    await cad.sendCommand(`(command "_.DRAWORDER" (handent "${escapeLispString(handle)}") "" "_U" (handent "${escapeLispString(referenceHandle)}"))\n`);
    return mcpSuccess(`已置于 ${referenceHandle} 之下`);
});

export const selectAll = withCadConnection(async () => {
    const result = await cad.sendCommandWithResult('(progn (setq ss (ssget "_X")) (setq handles nil) (setq i 0) (if ss (repeat (sslength ss) (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles)) (setq i (1+ i)))) (vl-prin1-to-string (reverse handles)))');
    return mcpSuccess(result || '[]');
});

export const selectLast = withCadConnection(async () => {
    const result = await cad.sendCommandWithResult('(vl-princ-to-string (list (cdr (assoc 5 (entget (entlast))))))');
    return mcpSuccess(result || 'nil');
});

export const selectByColor = withCadConnection(async (colorIndex) => {
    const result = await cad.sendCommandWithResult(`(progn (setq ss (ssget "_X" (list (cons 62 ${colorIndex})))) (setq handles nil) (setq i 0) (if ss (repeat (sslength ss) (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles)) (setq i (1+ i)))) (vl-prin1-to-string (reverse handles)))`);
    return mcpSuccess(result || '[]');
});
