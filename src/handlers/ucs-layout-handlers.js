import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

function toSafePoint(pt) {
  const parts = (Array.isArray(pt) ? pt : String(pt).split(/[,\s]+/)).map(Number);
  return parts.filter(n => !isNaN(n)).join(' ');
}

export async function createUcs(name, origin = '0,0,0', xAxis = '1,0,0', yAxis = '0,1,0') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (not (tblsearch "UCS" "${escapeLispString(name)}"))
            (progn
                (command "._UCS" "N" "${escapeLispString(name)}")
                (command "._UCS" "${escapeLispString(name)}" "O" (list ${toSafePoint(origin)}))
                (command "._UCS" "${escapeLispString(name)}" "X" (list ${toSafePoint(xAxis)}))
                (command "._UCS" "${escapeLispString(name)}" "Y" (list ${toSafePoint(yAxis)}))
                "CREATED"
            )
            "EXISTS"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'CREATED' || result === '"CREATED"') {
            return { content: [{ type: 'text', text: `已创建 UCS: ${name}` }] };
        }
        if (result === 'EXISTS' || result === '"EXISTS"') {
            return { content: [{ type: 'text', text: `UCS 已存在: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `创建失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setUcs(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (tblsearch "UCS" "${escapeLispString(name)}")
            (progn
                (command "._UCS" "R" "${escapeLispString(name)}")
                "SET"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'SET' || result === '"SET"') {
            return { content: [{ type: 'text', text: `已切换到 UCS: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `UCS 不存在: ${name}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function listUcs() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq ucsList nil)
        (while (setq u (tblnext "UCS" (null ucsList)))
            (setq ucsList (cons (cdr (assoc 2 u)) ucsList))
        )
        (reverse ucsList)
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '当前没有 UCS' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function deleteUcs(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (tblsearch "UCS" "${escapeLispString(name)}")
            (progn
                (command "._UCS" "D" "${escapeLispString(name)}")
                "DELETED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'DELETED' || result === '"DELETED"') {
            return { content: [{ type: 'text', text: `已删除 UCS: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `UCS 不存在: ${name}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getCurrentUcs() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (vla-get-activeutilities (vla-get-document (vla-get-application (vlax-get-acad-object))))
        (vl-prin1-to-string (getvar "UCSNAME"))
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '未命名' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function createLayout(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq @layouts (layoutlist))
        (if (member "${escapeLispString(name)}" @layouts)
            "EXISTS"
            (progn
                (command "._LAYOUT" "N" "${escapeLispString(name)}")
                "CREATED"
            )
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'CREATED' || result === '"CREATED"') {
            return { content: [{ type: 'text', text: `已创建布局: ${name}` }] };
        }
        if (result === 'EXISTS' || result === '"EXISTS"') {
            return { content: [{ type: 'text', text: `布局已存在: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `创建失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setLayout(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq @result "NOTFOUND")
        (vlax-for layout (vla-get-layouts (vla-get-activedocument (vlax-get-acad-object)))
            (if (= (vla-get-name layout) "${escapeLispString(name)}")
                (progn
                    (vla-put-activelayout (vla-get-activedocument (vlax-get-acad-object)) layout)
                    (setq @result "SET")
                )
            )
        )
        @result
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'SET' || result === '"SET"') {
            return { content: [{ type: 'text', text: `已切换到布局: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `布局不存在: ${name}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function listLayouts() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (vl-prin1-to-string (layoutlist))
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '当前没有布局' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function deleteLayout(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    if (name === 'Model' || name === '模型') {
        return { content: [{ type: 'text', text: '无法删除模型空间' }], isError: true };
    }

    const code = `(progn
        (vl-load-com)
        (if (member "${escapeLispString(name)}" (layoutlist))
            (progn
                (command "._LAYOUT" "D" "${escapeLispString(name)}")
                "DELETED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'DELETED' || result === '"DELETED"') {
            return { content: [{ type: 'text', text: `已删除布局: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `布局不存在: ${name}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getCurrentLayout() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(vl-prin1-to-string (getvar "CTAB"))`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || 'Model' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function renameLayout(oldName, newName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (member "${escapeLispString(oldName)}" (layoutlist))
            (progn
                (command ".-LAYOUT" "R" "${escapeLispString(oldName)}" "${escapeLispString(newName)}")
                "RENAMED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'RENAMED' || result === '"RENAMED"') {
            return { content: [{ type: 'text', text: `已将布局 ${oldName} 重命名为 ${newName}` }] };
        }
        return { content: [{ type: 'text', text: `布局不存在: ${oldName}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}