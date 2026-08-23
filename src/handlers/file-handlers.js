import { cad } from '../cad.js';
import { escapeLispString, validateFilePath } from '../handler-utils.js';

export async function openDwg(filePath) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    try {
      validateFilePath(filePath);
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }

    const code = `(progn
        (vl-load-com)
        (if (vl-file-directory-p (vl-filename-directory "${escapeLispString(filePath)}"))
            (progn
                (if (findfile "${escapeLispString(filePath)}")
                    (progn
                        (command "._OPEN" "${escapeLispString(filePath)}")
                        "OPENED"
                    )
                    "NOTFOUND"
                )
            )
            "INVALIDPATH"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'OPENED' || result === '"OPENED"') {
            return { content: [{ type: 'text', text: `已打开文件: ${filePath}` }] };
        }
        if (result === 'NOTFOUND' || result === '"NOTFOUND"') {
            return { content: [{ type: 'text', text: `文件不存在: ${filePath}` }], isError: true };
        }
        if (result === 'INVALIDPATH' || result === '"INVALIDPATH"') {
            return { content: [{ type: 'text', text: `路径无效: ${filePath}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `打开失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function saveDwg(filePath = null) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    if (filePath) {
      try {
        validateFilePath(filePath);
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }

    const code = filePath
        ? `(progn
            (vl-load-com)
            (command "._SAVEAS" "${escapeLispString(filePath)}")
            "SAVED"
        )`
        : `(progn
            (vl-load-com)
            (command "._QSAVE")
            "SAVED"
        )`;

    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'SAVED' || result === '"SAVED"') {
            return { content: [{ type: 'text', text: filePath ? `已保存为: ${filePath}` : '已保存当前文件' }] };
        }
        return { content: [{ type: 'text', text: `保存失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function exportPdf(outputPath, layout = 'Model') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    try {
      validateFilePath(outputPath);
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }

    const code = `(progn
        (vl-load-com)
        (vlax-for doc (vla-get-Documents (vla-get-Application (vlax-get-acad-object)))
            (if (or (eq (vla-get-Name doc) "${escapeLispString(layout)}") (eq "${escapeLispString(layout)}" "Model"))
                (progn
                    (vla-Export doc "${escapeLispString(outputPath)}" "pdf")
                    (setq exported T)
                )
            )
        )
        (if exported "EXPORTED" "FAILED")
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'EXPORTED' || result === '"EXPORTED"') {
            return { content: [{ type: 'text', text: `已导出 PDF: ${outputPath}` }] };
        }
        return { content: [{ type: 'text', text: `导出失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function closeDwg(save = false) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if ${save ? 'T' : 'nil'}
            (command "._CLOSE" "Y")
            (command "._CLOSE")
        )
        "CLOSED"
    )`;
    try {
        await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: '已关闭图形' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function exportSvg(outputPath, layout = 'Model') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        validateFilePath(outputPath);
        const code = `(progn (vl-load-com) (setq doc (vla-get-activedocument (vlax-get-acad-object))) (setq layouts (vla-get-layouts doc)) (setq lay (vla-item layouts "${escapeLispString(layout)}")) (vla-Export lay "${escapeLispString(outputPath)}" "svg") (princ))`;
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: `已导出 SVG: ${outputPath}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function exportBmp(outputPath) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        validateFilePath(outputPath);
        await cad.sendCommand(`(command "_.SAVEIMG" "${escapeLispString(outputPath)}" "b")\n`);
        return { content: [{ type: 'text', text: `已导出 BMP: ${outputPath}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function exportStl(outputPath, handle = null) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        validateFilePath(outputPath);
        const sel = handle ? `(ssadd (handent "${escapeLispString(handle)}"))` : '(ssget "_X" \'((0 . "3DSOLID")))';
        await cad.sendCommand(`(command "_.EXPORT" "${escapeLispString(outputPath)}" "" ${sel})\n`);
        return { content: [{ type: 'text', text: `已导出 STL: ${outputPath}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}