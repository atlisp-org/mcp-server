import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function toSafePoint(pt) {
  const parts = (Array.isArray(pt) ? pt : String(pt).split(/[,\s]+/)).map(Number);
  return parts.filter(n => !isNaN(n)).join(' ');
}

export async function plotToPdf(outputPath, layout = 'Model', style = {}) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const paperSize = style.paperSize || 'A4';
    const code = `(progn
        (vl-load-com)
        (setq doc (vla-get-activedocument (vlax-get-acad-object)))
        (vlax-for layout (vla-get-layouts doc)
            (if (or (eq (vla-get-name layout) "${escapeLispString(layout)}") (eq "${escapeLispString(layout)}" "Model"))
                (progn
                    (vla-put-active layout)
                    (vla-plottofile doc "${escapeLispString(outputPath)}" "${escapeLispString(paperSize)}")
                    (setq result "EXPORTED")
                )
            )
        )
        (if result result "FAILED")
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'EXPORTED' || result === '"EXPORTED"') {
            return { content: [{ type: 'text', text: `已打印到 PDF: ${outputPath}` }] };
        }
        return { content: [{ type: 'text', text: `打印失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function plotToPrinter(printerName, layout = 'Model') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq doc (vla-get-activedocument (vlax-get-acad-object)))
        (vlax-for layout (vla-get-layouts doc)
            (if (or (eq (vla-get-name layout) "${escapeLispString(layout)}") (eq "${escapeLispString(layout)}" "Model"))
                (progn
                    (vla-put-active layout)
                    (vla-plottofile doc "${escapeLispString(printerName)}")
                    (setq result "PRINTED")
                )
            )
        )
        (if result result "FAILED")
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result === 'PRINTED' ? '已发送到打印机' : '打印失败' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function createGroup(name, handles) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    if (!Array.isArray(handles) || handles.length === 0) {
        return { content: [{ type: 'text', text: '句柄列表为空' }], isError: true };
    }

    const handlesCode = handles.map(h => `(ssadd (handent "${escapeLispString(h)}") ss)`).join('\n');
    const code = `(progn
        (vl-load-com)
        (setq ss (ssadd))
        ${handlesCode}
        (command "._GROUP" "C" "${escapeLispString(name)}" "" ss "")
        "CREATED"
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'CREATED' || result === '"CREATED"') {
            return { content: [{ type: 'text', text: `已创建组: ${name}` }] };
        }
        return { content: [{ type: 'text', text: `创建失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function deleteGroup(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq @dict (dictsearch (namedobjdict) "ACAD_GROUP"))
        (if (and @dict (dictsearch (cdr (assoc -1 @dict)) "${escapeLispString(name)}"))
            (progn
                (command "._GROUP" "D" "${escapeLispString(name)}")
                "DELETED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'DELETED' || result === '"DELETED"') {
            return { content: [{ type: 'text', text: `已删除组: ${name}` }] };
        }
        return { content: [{ type: 'text', text: result === 'NOTFOUND' ? `组不存在: ${name}` : '删除失败' }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function listGroups() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq @groups nil)
        (setq @dict (dictsearch (namedobjdict) "ACAD_GROUP"))
        (if @dict
          (setq @group-dict (cdr (assoc -1 @dict)))
          (setq @group-dict nil))
        (if @group-dict
          (progn
            (setq @entry (dictsearch @group-dict "*"))
            (while @entry
              (setq @groups (cons (cdr (assoc 3 @entry)) @groups))
              (setq @entry (dictsearch @group-dict @entry))
            )
            (vl-prin1-to-string (reverse @groups))
          )
          "nil"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '无组' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getGroupEntities(groupName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq @dict (dictsearch (namedobjdict) "ACAD_GROUP"))
        (if (and @dict (dictsearch (cdr (assoc -1 @dict)) "${escapeLispString(groupName)}"))
            (progn
                (command "._SELECT" "G" "${escapeLispString(groupName)}" "")
                (if (and (getvar 'ssmode) (ssget-first))
                    (progn
                        (setq ss (ssget "+" (list (cons 410 (getvar 'ctab)))))
                        (if ss
                            (progn
                                (setq cnt (sslength ss) handles nil i 0)
                                (while (< i cnt)
                                    (setq handles (cons (cdr (assoc 5 (entget (ssname ss i)))) handles))
                                    (setq i (1+ i)))
                                (reverse handles)
                            )
                            nil
                        )
                        (sssetfirst nil)
                    )
                    nil
                )
            )
            nil
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '无实体' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function measureDistance(p1, p2) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq pt1 (list ${toSafePoint(p1)}) pt2 (list ${toSafePoint(p2)}))
        (setq dist (distance pt1 pt2))
        (setq ang (angle pt1 pt2))
        (list
            (strcat "Distance: " (rtos dist 2 4))
            (strcat "Angle: " (rtos (* 180 (/ ang pi)) 2 2) "°")
            (strcat "DX: " (rtos (- (car pt2) (car pt1)) 2 4))
            (strcat "DY: " (rtos (- (cadr pt2) (cadr pt1)) 2 4))
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '测量失败' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function measureArea(points) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const pts = Array.isArray(points) ? points : points.split(/[\s,]+/).filter(Boolean);
    if (pts.length < 3) {
        return { content: [{ type: 'text', text: '至少需要 3 个点' }], isError: true };
    }

    const coords = pts.map((p, i) => {
        const parts = String(p).split(',').map(Number);
        return parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])
          ? `(list ${parts[0]} ${parts[1]})`
          : '(list 0 0)';
    }).join(' ');

    const code = `(progn
        (vl-load-com)
        (setq pts (list ${coords}))
        (if (>= (length pts) 3)
            (progn
                (command "._PLINE")
                (foreach p pts (command p))
                (command "")
                (command "._AREA" "O" "L")
                (list
                    (strcat "Area: " (rtos (getvar 'area) 2 4) " sq units")
                    (strcat "Perimeter: " (rtos (getvar 'perimeter) 2 4))
                )
            )
            "NEED_3_POINTS"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        return { content: [{ type: 'text', text: result || '测量失败' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function publishLayouts(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

  const layouts = Array.isArray(args.layouts) ? args.layouts : [args.layouts || 'Model'];
  const outputDir = args.outputDir || '.';
  const namingRule = args.namingRule || '{layout}';
  const format = args.format || 'PDF';
  const merge = args.merge !== false;

  let results = [];
  for (const layout of layouts) {
    try {
      const safeName = String(layout).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
      const outputPath = namingRule.replace('{layout}', safeName).replace('{format}', format.toLowerCase());
      const fullPath = outputDir.endsWith('/') || outputDir.endsWith('\\')
        ? `${outputDir}${outputPath}.${format.toLowerCase()}`
        : `${outputDir}/${outputPath}.${format.toLowerCase()}`;

      const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq found nil)
  (vlax-for l (vla-get-layouts doc)
    (if (= (vla-get-name l) "${escapeLispString(layout)}")
      (progn
        (vla-put-active l)
        (vla-plottofile doc "${escapeLispString(fullPath)}" "A4")
        (setq found "ok")
      )
    )
  )
  (if found (princ found) (princ "not found"))
)`);
      results.push({ layout, outputPath: fullPath, success: result === 'ok' });
    } catch (e) {
      results.push({ layout, outputPath: '', success: false, error: e.message });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const msg = `布局批量发布完成: 成功 ${successCount}/${results.length}`;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ summary: msg, results })
    }],
    isError: successCount < results.length
  };
}

export async function batchPlotWizard(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

  const layouts = Array.isArray(args.layouts) ? args.layouts : [args.layouts || 'Model'];
  const outputDir = args.outputDir || '.';
  const format = (args.format || 'PDF').toUpperCase();
  const namingRule = args.namingRule || '{layout}';
  const pageSetup = args.pageSetup || '';

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const results = [];

  for (const layout of layouts) {
    try {
      const safeName = String(layout).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
      const outputName = namingRule
        .replace('{layout}', safeName)
        .replace('{date}', dateStr)
        .replace('{format}', format.toLowerCase());
      const fullPath = outputDir.endsWith('/') || outputDir.endsWith('\\')
        ? `${outputDir}${outputName}.${format.toLowerCase()}`
        : `${outputDir}/${outputName}.${format.toLowerCase()}`;

      const preview = args.preview === true;
      if (preview) {
        results.push({ layout, outputPath: fullPath, status: 'PREVIEW' });
        continue;
      }

      const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq found nil)
  (vlax-for l (vla-get-layouts doc)
    (if (= (vla-get-name l) "${escapeLispString(layout)}")
      (progn
        (vla-put-active l)
        ${pageSetup ? `(vla-put-activelayout doc "${escapeLispString(pageSetup)}")` : ''}
        (vla-plottofile doc "${escapeLispString(fullPath)}" "A4")
        (setq found "ok")
      )
    )
  )
  (if found found "not found")
)`;
      const result = await cad.sendCommandWithResult(code);
      results.push({ layout, outputPath: fullPath, status: result === 'ok' ? 'EXPORTED' : 'FAILED', raw: result });
    } catch (e) {
      results.push({ layout, outputPath: '', status: 'ERROR', error: e.message });
    }
  }

  const successCount = results.filter(r => r.status === 'EXPORTED').length;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary: `批量打印完成: 成功 ${successCount}/${results.length}`,
        total: results.length,
        success: successCount,
        results
      })
    }],
    isError: successCount < results.length
  };
}

export async function plotDeviceManagement(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

  const action = (args.action || 'list').toLowerCase();

  try {
    if (action === 'list') {
      const code = `(progn
  (vl-load-com)
  (setq cfg (vla-get-plotconfigurations (vla-get-activedocument (vlax-get-acad-object))))
  (setq devices nil i 0)
  (vlax-for pc cfg
    (setq devices (cons
      (list
        "name" (vla-get-name pc)
        "description" (vla-get-description pc)
        "paperSizes" (vlax-get pc 'CanonicalMediaNames)
        "isValid" (vla-get-valid pc)
      )
      devices
    ))
  )
  (reverse devices)
)`;
      const result = await cad.sendCommandWithResult(code);
      return { content: [{ type: 'text', text: result || '无打印设备' }] };
    }

    if (action === 'get') {
      const name = args.name || '';
      if (!name) return { content: [{ type: 'text', text: '需要 name 参数' }], isError: true };
      const code = `(progn
  (vl-load-com)
  (setq cfg (vla-get-plotconfigurations (vla-get-activedocument (vlax-get-acad-object))))
  (setq found nil)
  (vlax-for pc cfg
    (if (= (vla-get-name pc) "${escapeLispString(name)}")
      (setq found (list
        "name" (vla-get-name pc)
        "description" (vla-get-description pc)
        "paperSizes" (vlax-get pc 'CanonicalMediaNames)
        "isValid" (vla-get-valid pc)
        "locDeviceName" (vlax-get pc 'LocDeviceName)
      ))
    )
  )
  (if found found (strcat "NOTFOUND:" "${escapeLispString(name)}"))
)`;
      const result = await cad.sendCommandWithResult(code);
      return { content: [{ type: 'text', text: result }] };
    }

    if (action === 'set') {
      const name = args.name || '';
      if (!name) return { content: [{ type: 'text', text: '需要 name 参数' }], isError: true };
      const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (vla-put-activeplotconfig doc "${escapeLispString(name)}")
  (if (= (vla-get-activeplotconfig doc) "${escapeLispString(name)}") "SET" "FAILED")
)`;
      const result = await cad.sendCommandWithResult(code);
      return { content: [{ type: 'text', text: result === 'SET' ? `打印设备已设为: ${name}` : `设置失败: ${result || name}` }] };
    }

    if (action === 'test') {
      const name = args.name;
      const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  ${name ? `(vla-put-activeplotconfig doc "${escapeLispString(name)}")` : ''}
  (setq cfg (vla-get-activeplotconfig doc))
  (list
    "name" cfg
    "canPlot" (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-plottofile (list doc (strcat (vl-filename-mktemp) ".pdf") "A4"))) "FAIL" "OK")
  )
)`;
      const result = await cad.sendCommandWithResult(code);
      return { content: [{ type: 'text', text: result || '测试失败' }] };
    }

    return { content: [{ type: 'text', text: `未知 action: ${action}` }], isError: true };
  } catch (e) {
    return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
  }
}

export async function plotLog(args) {
  const homedir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || '');
  const logPath = path.join(homedir, '.atlisp', 'plot-log.json');

  let logs = [];
  try {
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'utf-8');
      logs = JSON.parse(raw);
      if (!Array.isArray(logs)) logs = [];
    }
  } catch {
    logs = [];
  }

  const from = args.fromDate ? new Date(args.fromDate).getTime() : 0;
  const to = args.toDate ? new Date(args.toDate).getTime() : Date.now() + 86400000;
  const status = args.status ? args.status.toLowerCase() : '';

  const filtered = logs.filter(entry => {
    const t = new Date(entry.timestamp || entry.date || 0).getTime();
    if (t < from || t > to) return false;
    if (status && (entry.status || '').toLowerCase() !== status) return false;
    return true;
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        total: filtered.length,
        fromDate: args.fromDate || null,
        toDate: args.toDate || null,
        statusFilter: args.status || null,
        entries: filtered
      })
    }]
  };
}

export async function plotFromFileList(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

  let fileList = [];
  if (Array.isArray(args.fileList)) {
    fileList = args.fileList;
  } else if (args.textFile) {
    try {
      const content = fs.readFileSync(args.textFile, 'utf-8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      fileList = lines.map(line => {
        const parts = line.split('|').map(s => s.trim());
        return { dwgPath: parts[0], layout: parts[1] || 'Model', outputPath: parts[2] || '' };
      });
    } catch (e) {
      return { content: [{ type: 'text', text: `读取文件失败: ${e.message}` }], isError: true };
    }
  } else {
    return { content: [{ type: 'text', text: '需要 fileList 或 textFile' }], isError: true };
  }

  if (fileList.length === 0) {
    return { content: [{ type: 'text', text: '文件列表为空' }], isError: true };
  }

  const results = [];

  for (const item of fileList) {
    try {
      const dwgPath = item.dwgPath;
      const layout = item.layout || 'Model';
      let outputPath = item.outputPath;

      if (!dwgPath) {
        results.push({ dwgPath: '', layout, outputPath: '', status: 'ERROR', error: '缺少 dwgPath' });
        continue;
      }

      if (!outputPath) {
        const ext = '.pdf';
        outputPath = dwgPath.replace(/\.dwg$/i, '') + `_${layout}${ext}`;
      }

      let openResult;
      if (dwgPath) {
        openResult = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-open (vla-get-documents (vlax-get-acad-object)) "${escapeLispString(dwgPath)}"))
  (if doc "OPENED" "FAILED")
)`);
        if (openResult !== 'OPENED') {
          results.push({ dwgPath, layout, outputPath, status: 'ERROR', error: `打开文件失败: ${openResult || ''}` });
          continue;
        }
      }

      const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq found nil)
  (vlax-for l (vla-get-layouts doc)
    (if (= (vla-get-name l) "${escapeLispString(layout)}")
      (progn
        (vla-put-active l)
        (vla-plottofile doc "${escapeLispString(outputPath)}" "A4")
        (setq found "ok")
      )
    )
  )
  (if found found "not found")
)`;
      const result = await cad.sendCommandWithResult(code);
      results.push({ dwgPath, layout, outputPath, status: result === 'ok' ? 'EXPORTED' : 'FAILED', raw: result });
    } catch (e) {
      results.push({ dwgPath: item.dwgPath || '', layout: item.layout || 'Model', outputPath: item.outputPath || '', status: 'ERROR', error: e.message });
    }
  }

  const successCount = results.filter(r => r.status === 'EXPORTED').length;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary: `文件列表批量打印完成: 成功 ${successCount}/${results.length}`,
        total: results.length,
        success: successCount,
        results
      })
    }],
    isError: successCount < results.length
  };
}

export async function getEntityInfo(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (setq ed (entget ent) typ (cdr (assoc 0 ed)))
                (list
                    "type" typ
                    "handle" (cdr (assoc 5 ed))
                    "layer" (cdr (assoc 8 ed))
                    "color" (if (assoc 62 ed) (cdr (assoc 62 ed)) 256)
                    "linetype" (if (assoc 6 ed) (cdr (assoc 6 ed)) "ByLayer")
                    "layerFrozen" (if (assoc 70 ed) (/= (logand (cdr (assoc 70 ed)) 1) 0) nil)
                    "layerLocked" (if (assoc 70 ed) (/= (logand (cdr (assoc 70 ed)) 4) 0) nil)
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

export async function createPageSetup(name, printer = 'DWG To PDF.pc3', paperSize = 'A4', orientation = 'Landscape', scale = '1:1') {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.-PAGESETUP" "${escapeLispString(name)}" "" "" "${escapeLispString(printer)}" "${escapeLispString(paperSize)}" "${orientation}" "N" "${scale}" "1=1" "" "N" "" "" "")\n`);
        return { content: [{ type: 'text', text: `已创建页面设置: ${name}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function listPageSetups() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult('(progn (setq setups nil) (vlax-for ps (vla-get-plotconfigurations (vla-get-activedocument (vlax-get-acad-object))) (setq setups (cons (vla-get-name ps) setups))) (reverse setups))');
        return { content: [{ type: 'text', text: result || '[]' }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function setPageSetup(layout, pageSetupName) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(command "_.-PAGESETUP" "${escapeLispString(pageSetupName)}" "" "${escapeLispString(layout)}")\n`);
        return { content: [{ type: 'text', text: `已为布局 ${layout} 设置页面设置: ${pageSetupName}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}
export async function importPageSetup(dwgPath, pageSetupName = null) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const namePart = pageSetupName ? ` "${escapeLispString(pageSetupName)}"` : ' "*"';
        await cad.sendCommand(`(command "_.-PSETUPIN" "${escapeLispString(dwgPath)}" ${namePart})\n`);
        return { content: [{ type: 'text', text: `已导入页面设置: ${dwgPath}` }] };
    } catch (e) { return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }; }
}