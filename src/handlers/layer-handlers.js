import { cad } from '../cad.js';
import { withCadConnection, mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';

export const createLayer = withCadConnection(async (name, color = 7, linetype = 'Continuous') => {
    const code = `(progn
        (vl-load-com)
             (if (not (tblsearch "LAYER" "${escapeLispString(name)}"))
            (progn
                (entmake
                    (list
                        (cons 0 "LAYER")
                        (cons 70 0)
                        (cons 2 "${escapeLispString(name)}")
                        (cons 62 ${color})
                        (cons 6 "${escapeLispString(linetype)}")
                    )
                )
                "CREATED"
            )
            "EXISTS"
        )
    )`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'CREATED' || result === '"CREATED"') {
        return mcpSuccess(`已创建图层: ${name}`);
    }
    if (result === 'EXISTS' || result === '"EXISTS"') {
        return mcpSuccess(`图层已存在: ${name}`);
    }
    return mcpError(`创建失败: ${result}`);
});

export const deleteLayer = withCadConnection(async (name) => {
    const code = `(progn
        (vl-load-com)
        (cond
            ((eq (getvar "CLAYER") "${escapeLispString(name)}")
             "CURRENT")
            ((tblsearch "LAYER" "${escapeLispString(name)}")
             (command "._LAYER" "D" "${escapeLispString(name)}" "")
(if (not (tblsearch "LAYER" "${escapeLispString(name)}"))
                 "DELETED"
                 "FAILED"))
            (t "NOTFOUND")
        )
    )`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'DELETED' || result === '"DELETED"') {
        return mcpSuccess(`已删除图层: ${name}`);
    }
    if (result === 'CURRENT' || result === '"CURRENT"') {
        return mcpError(`无法删除当前图层: ${name}`);
    }
    if (result === 'NOTFOUND' || result === '"NOTFOUND"') {
        return mcpError(`图层不存在: ${name}`);
    }
    return mcpError(`删除失败: ${result}`);
});

export const setLayerProperty = withCadConnection(async (name, property, value) => {
    let propCode;
    switch (property) {
        case 'color':
            propCode = `(command "._LAYER" "P" "${escapeLispString(name)}" "C" ${isNaN(Number(value)) ? 7 : Number(value)} "")`;
            break;
        case 'linetype':
            propCode = `(command "._LAYER" "P" "${escapeLispString(name)}" "L" "${escapeLispString(value)}" "")`;
            break;
        case 'freeze':
            propCode = `(command "._LAYER" "F" "${escapeLispString(name)}" "")`;
            break;
        case 'thaw':
            propCode = `(command "._LAYER" "T" "${escapeLispString(name)}" "")`;
            break;
        case 'lock':
            propCode = `(command "._LAYER" "LO" "${escapeLispString(name)}" "")`;
            break;
        case 'unlock':
            propCode = `(command "._LAYER" "U" "${escapeLispString(name)}" "")`;
            break;
        default:
            return mcpError(`不支持的属性: ${property}`);
    }

    const code = `(progn
        (vl-load-com)
        (if (tblsearch "LAYER" "${escapeLispString(name)}")
            (progn
                ${propCode}
                "OK"
            )
            "NOTFOUND"
        )
    )`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'OK' || result === '"OK"') {
        return mcpSuccess(`已设置图层 ${name} 的 ${property} 为 ${value}`);
    }
    return mcpError(`操作失败: ${result}`);
});

export const setCurrentLayer = withCadConnection(async (name) => {
    const code = `(progn
        (vl-load-com)
        (if (tblsearch "LAYER" "${escapeLispString(name)}")
            (progn
                (setvar "CLAYER" "${escapeLispString(name)}")
                "OK"
            )
            "NOTFOUND"
        )
    )`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'OK' || result === '"OK"') {
        return mcpSuccess(`已设置当前图层: ${name}`);
    }
    return mcpError(`设置失败: ${result}`);
});

export const layerIsolate = withCadConnection(async (name) => {
    await cad.sendCommand(`(command "_.LAYISO" "${escapeLispString(name)}" "")\n`);
    return mcpSuccess(`已隔离图层: ${name}`);
});

export const layerUnisolate = withCadConnection(async () => {
    await cad.sendCommand('(command "_.LAYUNISO")\n');
    return mcpSuccess('已取消图层隔离');
});

export const layerFreezeAll = withCadConnection(async () => {
    await cad.sendCommand('(command "_.LAYER" "F" "*" "")\n');
    return mcpSuccess('已冻结所有图层');
});

export const layerThawAll = withCadConnection(async () => {
    await cad.sendCommand('(command "_.LAYER" "T" "*" "")\n');
    return mcpSuccess('已解冻所有图层');
});

export const layerLockAll = withCadConnection(async () => {
    await cad.sendCommand('(command "_.LAYER" "LO" "*" "")\n');
    return mcpSuccess('已锁定所有图层');
});

export const layerUnlockAll = withCadConnection(async () => {
    await cad.sendCommand('(command "_.LAYER" "U" "*" "")\n');
    return mcpSuccess('已解锁所有图层');
});

export const layerMerge = withCadConnection(async (sourceName, targetName) => {
    await cad.sendCommand(`(command "_.LAYMRG" "${escapeLispString(sourceName)}" "" "${escapeLispString(targetName)}" "Y")\n`);
    return mcpSuccess(`已将图层 ${sourceName} 合并到 ${targetName}`);
});
