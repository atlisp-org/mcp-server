import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function createLayer(name, color = 7, linetype = 'Continuous') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

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
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'CREATED' || result === '"CREATED"') {
            return { content: [{ type: 'text', text: `已创建图层: ${name}` }] };
        }
        if (result === 'EXISTS' || result === '"EXISTS"') {
            return { content: [{ type: 'text', text: `图层已存在: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `创建失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function deleteLayer(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

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
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'DELETED' || result === '"DELETED"') {
            return { content: [{ type: 'text', text: `已删除图层: ${name}` }] };
        }
        if (result === 'CURRENT' || result === '"CURRENT"') {
            return { content: [{ type: 'text', text: `无法删除当前图层: ${name}` }], isError: true };
        }
        if (result === 'NOTFOUND' || result === '"NOTFOUND"') {
            return { content: [{ type: 'text', text: `图层不存在: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `删除失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setLayerProperty(name, property, value) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    let propCode = '';
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
            return { content: [{ type: 'text', text: `不支持的属性: ${property}` }], isError: true };
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
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置图层 ${name} 的 ${property} 为 ${value}` }] };
        }
        return { content: [{ type: 'text', text: `操作失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setCurrentLayer(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

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
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置当前图层: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `设置失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
export async function layerIsolate(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand(`(command "_.LAYISO" "${escapeLispString(name)}" "")\n`); return { content: [{ type: 'text', text: `已隔离图层: ${name}` }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerUnisolate() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand('(command "_.LAYUNISO")\n'); return { content: [{ type: 'text', text: '已取消图层隔离' }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerFreezeAll() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand('(command "_.LAYER" "F" "*" "")\n'); return { content: [{ type: 'text', text: '已冻结所有图层' }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerThawAll() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand('(command "_.LAYER" "T" "*" "")\n'); return { content: [{ type: 'text', text: '已解冻所有图层' }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerLockAll() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand('(command "_.LAYER" "LO" "*" "")\n'); return { content: [{ type: 'text', text: '已锁定所有图层' }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerUnlockAll() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand('(command "_.LAYER" "U" "*" "")\n'); return { content: [{ type: 'text', text: '已解锁所有图层' }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function layerMerge(sourceName, targetName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try { await cad.sendCommand(`(command "_.LAYMRG" "${escapeLispString(sourceName)}" "" "${escapeLispString(targetName)}" "Y")\n`); return { content: [{ type: 'text', text: `已将图层 ${sourceName} 合并到 ${targetName}` }] }; } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}