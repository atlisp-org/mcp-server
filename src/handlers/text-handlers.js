import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function findText(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const caseSensitive = params.caseSensitive ? 'T' : 'nil';
        const code = `(progn
            (vl-load-com)
            (setq ss (ssget "X" (list (cons 0 "TEXT,MTEXT") (cons 1 "${escapeLispString(params.pattern)}"))))
            (if ss
                (progn
                    (setq cnt (sslength ss) results nil i 0)
                    (while (< i cnt)
                        (setq ent (ssname ss i))
                        (setq h (cdr (assoc 5 (entget ent))))
                        (setq txt (cdr (assoc 1 (entget ent))))
                        (setq results (cons (list h txt) results))
                        (setq i (1+ i)))
                    (reverse results)
                )
                nil
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: `未找到匹配 "${params.pattern}" 的文本` }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function replaceText(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (setq cnt 0)
            (if (setq ss (ssget "X" (list (cons 0 "TEXT,MTEXT") (cons 1 "${escapeLispString(params.pattern)}"))))
                (progn
                    (setq i 0)
                    (while (< i (sslength ss))
                        (setq ent (ssname ss i))
                        (setq ed (entget ent))
                        (setq oldTxt (cdr (assoc 1 ed)))
                        (entmod (subst (cons 1 "${escapeLispString(params.replacement)}") (assoc 1 ed) ed))
                        (setq cnt (1+ cnt))
                        (setq i (1+ i)))
                )
            )
            cnt
        )`;
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: `已替换 ${result || 0} 处文本` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setTextHeight(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setq ed (entget ent))
                    (entmod (subst (cons 40 ${params.height}) (assoc 40 ed) ed))
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置文字高度: ${params.height}` }] };
        }
        return { content: [{ type: 'text', text: `设置失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setTextStyleName(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setq ed (entget ent))
                    (entmod (subst (cons 7 "${escapeLispString(params.styleName)}") (assoc 7 ed) ed))
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置文字样式: ${params.styleName}` }] };
        }
        return { content: [{ type: 'text', text: `设置失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function justifyText(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const justMap = {
            'TL': 1, 'TC': 2, 'TR': 3,
            'ML': 4, 'MC': 5, 'MR': 6,
            'BL': 7, 'BC': 8, 'BR': 9,
            'L': 0, 'C': 1, 'R': 2,
            'M': 4, 'B': 8, 'T': 2
        };
        const justVal = justMap[params.justification] || 0;
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (setq ed (entget ent))
                    (if (assoc 72 ed)
                        (entmod (subst (cons 72 ${justVal}) (assoc 72 ed) ed))
                        (entmod (append ed (list (cons 72 ${justVal}))))
                    )
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已设置文字对齐方式: ${params.justification}` }] };
        }
        return { content: [{ type: 'text', text: `设置失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function convertTextToMtext(params) {
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
                (progn (command "_.TXT2MTXT" ss "") "OK")
                "NO_ENTITIES"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已转换 ${params.handles.length} 个单行文字为多行文字` }] };
        }
        return { content: [{ type: 'text', text: `转换失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function explodeText(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (vl-load-com)
            (if (setq ent (handent "${escapeLispString(params.handle)}"))
                (progn
                    (command "_.TXTEXP" ent "")
                    "OK"
                )
                "NOTFOUND"
            )
        )`;
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OK' || result === '"OK"') {
            return { content: [{ type: 'text', text: `已分解文字为线: ${params.handle}` }] };
        }
        return { content: [{ type: 'text', text: `分解失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
