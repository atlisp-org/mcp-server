import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

function toSafePoint(pt) {
  const parts = (Array.isArray(pt) ? pt : String(pt).split(/[,\s]+/)).map(Number);
  return parts.filter(n => !isNaN(n)).join(' ');
}

export async function createDimension(type, points, style = {}) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    let dimCode = '';
    const validTypes = ['ALIGNED', 'LINEAR', 'ORDINATE', 'RADIAL', 'DIAMETER', 'ANGULAR'];
    const dimType = (type || 'ALIGNED').toUpperCase();

    if (!validTypes.includes(dimType)) {
        return { content: [{ type: 'text', text: `不支持的标注类型: ${type}` }], isError: true };
    }

    const defPt = toSafePoint(points.defPt || '0,0');
    const pt1 = toSafePoint(points.pt1 || points.pt || '0,0');
    const pt2 = toSafePoint(points.pt2 || '100,0');
    const leaderLen = parseFloat(style.leaderLength) || 10;

    switch (dimType) {
        case 'ALIGNED':
            dimCode = `(command "._DIMALIGNED" (list ${pt1}) (list ${pt2}) (list ${defPt}))`;
            break;
        case 'LINEAR':
            dimCode = `(command "._DIMLINEAR" (list ${pt1}) (list ${pt2}) (list ${defPt}))`;
            break;
        case 'ORDINATE':
            dimCode = `(command "._DIMORDINATE" (list ${pt1}) (list ${defPt}))`;
            break;
        case 'RADIAL':
            dimCode = `(command "._DIMRADIUS" (list ${defPt}) "${leaderLen}")`;
            break;
        case 'DIAMETER':
            dimCode = `(command "._DIMDIAMETER" (list ${defPt}) "${leaderLen}")`;
            break;
        case 'ANGULAR':
            dimCode = `(command "._DIMANGULAR" (list ${pt1}) (list ${pt2}) (list ${defPt}))`;
            break;
    }

    try {
        await cad.sendCommand(dimCode + '\n');
        return { content: [{ type: 'text', text: `已创建 ${dimType} 标注` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getDimensionValue(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (setq ed (entget ent) typ (cdr (assoc 0 ed)))
                (if (wcmatch typ "DIMENSION")
                    (list
                        "type" typ
                        "handle" (cdr (assoc 5 ed))
                        "layer" (cdr (assoc 8 ed))
                        "style" (if (assoc 2 ed) (cdr (assoc 2 ed)) "Standard")
                        "measurement" (if (assoc 42 ed) (rtos (cdr (assoc 42 ed)) 2 2) "0")
                    )
                    (list "error" "Not a dimension entity")
                )
            )
            (list "error" "Entity not found")
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '获取失败' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function createHatch(patternName, boundary, scale = 1, angle = 0) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (command "._BHATCH" "p" "${escapeLispString(patternName)}" "s" "s" "sc" ${scale} "an" ${angle} "")
        "CREATED"
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result && result !== 'nil') {
            return { content: [{ type: 'text', text: `已创建图案填充: ${patternName}` }] };
        }
        return { content: [{ type: 'text', text: '创建填充失败' }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setHatchProperties(handle, props) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    let propCode = '';
    if (props.pattern) propCode += `(command "._HATCHEDIT" "${escapeLispString(handle)}" "p" "${escapeLispString(props.pattern)}")`;
    if (props.scale) propCode += `(command "._HATCHEDIT" "${escapeLispString(handle)}" "s" ${parseFloat(props.scale) || 1})`;
    if (props.angle) propCode += `(command "._HATCHEDIT" "${escapeLispString(handle)}" "an" ${parseFloat(props.angle) || 0})`;
    if (props.color) propCode += `(command "._HATCHEDIT" "${escapeLispString(handle)}" "c" ${parseInt(props.color) || 256})`;

    const code = `(progn
        (vl-load-com)
        ${propCode}
        "UPDATED"
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: `已更新填充属性` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getBlockAttributes(blockHandle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(blockHandle)}"))
            (if (= (cdr (assoc 0 (entget ent))) "INSERT")
                (progn
                    (setq atts nil)
                    (setq att (entnext ent))
                    (while (and att (= (cdr (assoc 0 (entget att))) "ATTRIB"))
                        (setq atts (cons
                            (list (cdr (assoc 2 (entget att))) (cdr (assoc 1 (entget att))))
                            atts))
                        (setq att (entnext att)))
                    (reverse atts))
                (list "error" "Not a block reference"))
            (list "error" "Entity not found"))
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '无属性' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function setBlockAttribute(blockHandle, tag, value) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(blockHandle)}"))
            (progn
                (setq att (entnext ent))
                (while att
                    (if (= (cdr (assoc 0 (entget att))) "ATTRIB")
                        (if (= (strcase (cdr (assoc 2 (entget att)))) (strcase "${escapeLispString(tag)}"))
                            (progn
                                (entmod (subst (cons 1 "${escapeLispString(value)}") (assoc 1 (entget att)) (entget att)))
                                (setq att nil)
                            )
                        )
                    )
                    (setq att (entnext att))
                )
                "UPDATED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'UPDATED' || result === '"UPDATED"') {
            return { content: [{ type: 'text', text: `已设置属性 ${tag} = ${value}` }] };
        }
        return { content: [{ type: 'text', text: `设置失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function zoomToExtents() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (command "._ZOOM" "E")
        "DONE"
    )`;
    try {
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: '已缩放到图形范围' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function zoomToWindow(p1, p2) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(command "._ZOOM" "W" (list ${toSafePoint(p1)}) (list ${toSafePoint(p2)}))`;
    try {
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: '已缩放到窗口' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function createNamedView(viewName, center = null) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = center
        ? `(command ".-VIEW" "S" "${escapeLispString(viewName)}" "C" (list ${toSafePoint(center)}))`
        : `(command ".-VIEW" "S" "${escapeLispString(viewName)}")`;
    try {
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: `已创建命名视图: ${viewName}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function restoreNamedView(viewName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(command ".-VIEW" "R" "${escapeLispString(viewName)}")`;
    try {
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: `已恢复视图: ${viewName}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function listNamedViews() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq views nil)
        (while (setq v (tblnext "VIEW" (null views)))
            (setq views (cons (cdr (assoc 2 v)) views))
        )
        (reverse views)
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '无命名视图' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function exportDxf(outputPath, version = 'R2018') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const versionMap = {
        'R2018': 'AC1027', 'R2015': 'AC1024', 'R2013': 'AC1021',
        'R2010': 'AC1018', 'R2007': 'AC1015', 'R2004': 'AC1012',
        'R2000': 'AC1009'
    };
    const dxfVersion = versionMap[version] || 'AC1027';

    const code = `(progn
        (vl-load-com)
        (vla-saveas (vla-get-activedocument (vlax-get-acad-object)) "${escapeLispString(outputPath)}" "${dxfVersion}")
        "EXPORTED"
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'EXPORTED' || result === '"EXPORTED"') {
            return { content: [{ type: 'text', text: `已导出 DXF: ${outputPath}` }] };
        }
        return { content: [{ type: 'text', text: `导出失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function exportDwf(outputPath) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (vla-export (vla-get-activedocument (vlax-get-acad-object)) "${escapeLispString(outputPath)}" "dwf")
        "EXPORTED"
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'EXPORTED' || result === '"EXPORTED"') {
            return { content: [{ type: 'text', text: `已导出 DWF: ${outputPath}` }] };
        }
        return { content: [{ type: 'text', text: `导出失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function batchSetLayer(handles, layerName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    if (!Array.isArray(handles) || handles.length === 0) {
        return { content: [{ type: 'text', text: '句柄列表为空' }], isError: true };
    }

    const handlesStr = handles.map(h => `"${escapeLispString(h)}"`).join(' ');
    const code = `(progn
        (vl-load-com)
        (setq ss (ssadd))
        ${handlesStr.split('\n').map(h => `(ssadd (handent ${h}) ss)`).join('\n')}
        (command "._CHPROP" ss "" "LA" "${escapeLispString(layerName)}" "")
        (strcat "Updated " (itoa ${handles.length}) " entities")
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || `已批量设置 ${handles.length} 个实体图层为 ${layerName}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}