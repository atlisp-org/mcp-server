import { cad } from '../cad.js';

import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

export async function getXdata(handle, appName = 'ACAD') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (setq xdata (assoc -3 (entget ent (list "${escapeLispString(appName)}"))))
    (if xdata (princ (vl-prin1-to-string (cdr xdata))) (princ "nil"))
  ) (princ "nil"))
)`);
    let xdata = null;
    if (result && result !== 'nil' && result.trim()) { try { xdata = JSON.parse(result.trim()); } catch { xdata = result.trim(); } }
    return mcpSuccess(JSON.stringify({ handle, appName, xdata }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function setXdata(handle, appName, data) {
  try {
    await ensureCadConnected();
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const result = await cad.sendCommandWithResult(`(progn
  (regapp "${escapeLispString(appName)}")
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (setq oldxdata (assoc -3 (entget ent (list "${escapeLispString(appName)}"))))
    (setq entlist (if oldxdata (subst (cons -3 (list "${escapeLispString(appName)}" ${dataStr})) oldxdata (entget ent)) (append (entget ent) (list (cons -3 (list "${escapeLispString(appName)}" ${dataStr}))))))
    (entmod entlist) (princ "ok"))
  (princ "nil"))
)`);
    return mcpSuccess(JSON.stringify({ handle, appName, data: dataStr, set: result?.includes('ok') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function deleteXdata(handle, appName) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (setq oldxdata (assoc -3 (entget ent (list "${escapeLispString(appName)}"))))
    (if oldxdata (progn (entmod (vl-remove oldxdata (entget ent))) (princ "deleted")) (princ "notfound"))
  ) (princ "nil"))
)`);
    return mcpSuccess(JSON.stringify({ handle, appName, deleted: result?.includes('deleted') || result?.includes('notfound') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listXdataApps(handle) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (setq apps nil)
    (foreach x (entget ent) (if (= (car x) -3) (setq apps (cons (cadr x) apps))))
    (princ (vl-prin1-to-string (reverse apps)))
  ) (princ "nil"))
)`);
    let apps = [];
    if (result && result !== 'nil' && result.trim()) { try { apps = JSON.parse(result.trim()); } catch { apps = result.trim().replace(/[()]/g, '').split(' ').filter(Boolean); } }
    return mcpSuccess(JSON.stringify({ handle, apps }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function getAllEntityXdata(handle) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (setq result nil)
    (foreach x (entget ent) (if (= (car x) -3) (setq result (cons (list (cadr x) (cddr x)) result))))
    (princ (vl-prin1-to-string (reverse result)))
  ) (princ "nil"))
)`);
    let xdata = {};
    if (result && result !== 'nil' && result.trim()) { try { xdata = JSON.parse(result.trim()); } catch { xdata = {}; } }
    return mcpSuccess(JSON.stringify({ handle, xdata }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function copyXdata(sourceHandle, targetHandle, appName = null) {
  try {
    await ensureCadConnected();
    if (appName) {
      const xdataResult = await getXdata(sourceHandle, appName);
      if (xdataResult.content?.[0]) {
        const parsed = JSON.parse(xdataResult.content[0].text);
        if (parsed.xdata) return await setXdata(targetHandle, appName, parsed.xdata);
      }
      return mcpError('源实体未找到扩展数据');
    } else {
      const allXdata = await getAllEntityXdata(sourceHandle);
      if (allXdata.content?.[0]) {
        const parsed = JSON.parse(allXdata.content[0].text);
        if (parsed.xdata) {
          for (const [app, data] of Object.entries(parsed.xdata)) { await setXdata(targetHandle, app, data); }
          return mcpSuccess(JSON.stringify({ handles: [sourceHandle, targetHandle], copiedApps: Object.keys(parsed.xdata) }));
        }
      }
      return mcpError('未找到扩展数据');
    }
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function searchByXdata(appName, key, value) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq i -1 results nil ss (ssget "X" (list (cons -3 (list "${escapeLispString(appName)}" (list (cons 1000 "${escapeLispString(key)}") (cons 1000 "${escapeLispString(value)}")))))))
  (if ss (repeat (sslength ss) (setq results (cons (cdr (assoc -1 (entget (ssname ss (setq i (1+ i)))))) results))))
  (princ (vl-prin1-to-string (reverse results)))
)`);
    let handles = [];
    if (result && result !== 'nil' && result.trim()) { try { handles = JSON.parse(result.trim()); } catch { handles = []; } }
    return mcpSuccess(JSON.stringify({ appName, key, value, handles, count: handles.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function exportXdataToFile(handle, filePath) {
  try {
    await ensureCadConnected();
    const xdataResult = await getAllEntityXdata(handle);
    const parsed = JSON.parse(xdataResult.content[0].text);
    const fs = await import('fs');
    fs.writeFileSync(filePath, JSON.stringify(parsed.xdata, null, 2));
    return mcpSuccess(JSON.stringify({ handle, filePath }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function importXdataFromFile(handle, filePath, appName) {
  try {
    await ensureCadConnected();
    const fs = await import('fs');
    const data = fs.readFileSync(filePath, 'utf8');
    const xdata = JSON.parse(data);
    if (appName && xdata[appName]) {
      return await setXdata(handle, appName, xdata[appName]);
    } else {
      for (const [app, data] of Object.entries(xdata)) { await setXdata(handle, app, data); }
      return mcpSuccess(JSON.stringify({ handle, imported: Object.keys(xdata) }));
    }
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}
