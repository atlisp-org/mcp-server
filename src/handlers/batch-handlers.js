import { cad } from '../cad.js';
import { log } from '../logger.js';
import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

function parseHandleList(handles) {
  if (typeof handles === 'string') {
    const trimmed = handles.trim();
    if (trimmed.startsWith('[')) {
      try { handles = JSON.parse(trimmed); } catch { handles = handles.split(',').map(h => h.trim()); }
    } else {
      handles = handles.split(',').map(h => h.trim());
    }
  }
  if (!Array.isArray(handles)) handles = [handles];
  return handles;
}

export async function batchRename(handles, newNameTemplate, startNum = 1) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (let i = 0; i < handleList.length; i++) {
      const handle = handleList[i];
      const newName = newNameTemplate.replace('{n}', String(startNum + i).padStart(3, '0'));
      try {
        await cad.sendCommand(`(_vlax-set-property (vla-item (vla-get-blocks (vla-get-document (vlax-ename->vla-object (handent "${escapeLispString(handle)}")))) (handent "${escapeLispString(handle)}")) 'Name "${escapeLispString(newName)}")`);
        results.push({ handle, newName, success: true });
      } catch (e) {
        results.push({ handle, error: e.message, success: false });
      }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchMove(handles, fromLayer, toLayer) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        const cond = fromLayer ? `(= (cdr (assoc 8 (entget ent))) "${escapeLispString(fromLayer)}")` : 't';
        await cad.sendCommand(`(progn (setq ent (handent "${escapeLispString(handle)}")) (if ${cond} (entmod (subst (cons 8 "${escapeLispString(toLayer)}") (assoc 8 (entget ent)) (entget ent)))))`);
        results.push({ handle, fromLayer, toLayer, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchCopy(handles, dx, dy, dz = 0) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(command "_.copy" (handent "${escapeLispString(handle)}") "" (list 0 0 0) (list ${dx} ${dy} ${dz}))`);
        results.push({ originalHandle: handle, offset: { dx, dy, dz }, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchDelete(handles) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(entdel (handent "${escapeLispString(handle)}"))`);
        results.push({ handle, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchSetColor(handles, color) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(progn (setq ent (handent "${escapeLispString(handle)}")) (entmod (subst (cons 62 ${color}) (assoc 62 (entget ent)) (entget ent))) (princ "ok"))`);
        results.push({ handle, color, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchExplode(handles) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(progn (command "_.explode" (handent "${escapeLispString(handle)}")) (princ "ok"))`);
        results.push({ handle, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchMirror(handles, startPoint, endPoint, deleteOriginal = false) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        const pt1 = typeof startPoint === 'string' ? startPoint : startPoint.join(' ');
        const pt2 = typeof endPoint === 'string' ? endPoint : endPoint.join(' ');
        const delOpt = deleteOriginal ? 'yes' : 'no';
        await cad.sendCommand(`(progn (command "_.mirror" (handent "${escapeLispString(handle)}") "" "${escapeLispString(pt1)}" "${escapeLispString(pt2)}" "${delOpt}") (princ "ok"))`);
        results.push({ handle, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchOffset(handles, distance, side = 'both') {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        if (side === 'both') {
          await cad.sendCommand(`(command "_.offset" ${distance} (handent "${escapeLispString(handle)}") (list 0 0 0))`);
        } else {
          await cad.sendCommand(`(command "_.offset" ${distance} (handent "${escapeLispString(handle)}"))`);
        }
        results.push({ handle, distance, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchRotate(handles, angle, basePoint = null) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const base = basePoint ? (Array.isArray(basePoint) ? basePoint.join(' ') : basePoint) : '0,0';
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(command "_.rotate" (handent "${escapeLispString(handle)}") "" "${escapeLispString(base)}" "${angle}")`);
        results.push({ handle, angle, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchScale(handles, scaleFactor, basePoint = null) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const base = basePoint ? (Array.isArray(basePoint) ? basePoint.join(' ') : basePoint) : '0,0';
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(command "_.scale" (handent "${escapeLispString(handle)}") "" "${escapeLispString(base)}" "${scaleFactor}")`);
        results.push({ handle, scaleFactor, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchSetLinetype(handles, linetypeName) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(progn (command "_.chltype" (handent "${escapeLispString(handle)}") "${escapeLispString(linetypeName)}") (princ "ok"))`);
        results.push({ handle, linetype: linetypeName, success: true });
      } catch (e) { results.push({ handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchMatchProperties(sourceHandle, targetHandles) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(targetHandles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(command "_.matchprop" (handent "${escapeLispString(sourceHandle)}") (handent "${escapeLispString(handle)}"))`);
        results.push({ from: sourceHandle, to: handle, success: true });
      } catch (e) { results.push({ from: sourceHandle, to: handle, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchCreateGroup(name, handles) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const handleStr = handleList.map(h => `(handent "${escapeLispString(h)}")`).join(' ');
    const result = await cad.sendCommandWithResult(`(group (list ${handleStr}))`);
    return mcpSuccess(JSON.stringify({ name, handle: result?.trim() }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchAddToGroup(groupName, handles) {
  try {
    await ensureCadConnected();
    const handleList = parseHandleList(handles);
    const results = [];
    for (const handle of handleList) {
      try {
        await cad.sendCommand(`(progn (setq grp (cdr (assoc -3 (entget (tblobjname "group" "${escapeLispString(groupName)}"))))) (entmod (append (entget (tblobjname "group" "${escapeLispString(groupName)}")) (list (cons -3 (append grp (list (handent "${escapeLispString(handle)}"))))))) )`);
        results.push({ handle, group: groupName, success: true });
      } catch (e) { results.push({ handle, group: groupName, error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function moveEntity(handle, dx, dy, dz = 0) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.MOVE" (handent "${escapeLispString(handle)}") "" (list ${dx} ${dy} ${dz}) "")\n`); return mcpSuccess(JSON.stringify({ handle, dx, dy, dz })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function copyEntity(handle, dx, dy, dz = 0) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.COPY" (handent "${escapeLispString(handle)}") "" (list ${dx} ${dy} ${dz}) "")\n`); return mcpSuccess(JSON.stringify({ handle, dx, dy, dz })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function rotateEntity(handle, angle, basePoint = '0,0') {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.ROTATE" (handent "${escapeLispString(handle)}") "" (list ${(basePoint||'0,0').replace(/,/g,' ')}) ${angle})\n`); return mcpSuccess(JSON.stringify({ handle, angle, basePoint })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function scaleEntity(handle, scaleFactor, basePoint = '0,0') {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.SCALE" (handent "${escapeLispString(handle)}") "" (list ${(basePoint||'0,0').replace(/,/g,' ')}) ${scaleFactor})\n`); return mcpSuccess(JSON.stringify({ handle, scaleFactor, basePoint })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function mirrorEntity(handle, startPoint, endPoint, deleteOriginal = false) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.MIRROR" (handent "${escapeLispString(handle)}") "" (list ${startPoint.replace(/,/g,' ')}) (list ${endPoint.replace(/,/g,' ')}) ${deleteOriginal ? '"_Y"' : '"_N"'})\n`); return mcpSuccess(JSON.stringify({ handle, startPoint, endPoint, deleteOriginal })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function offsetEntity(handle, distance, side) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.OFFSET" ${distance} (handent "${escapeLispString(handle)}") (list ${side.replace(/,/g,' ')}) "")\n`); return mcpSuccess(JSON.stringify({ handle, distance, side })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function arrayRectangular(handle, rows, cols, rowSpacing, colSpacing) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.ARRAY" (handent "${escapeLispString(handle)}") "" "_R" ${rows} ${cols} ${rowSpacing} ${colSpacing})\n`); return mcpSuccess(JSON.stringify({ handle, rows, cols, rowSpacing, colSpacing })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
export async function arrayPolar(handle, center, count, angle = 360) {
    try { await ensureCadConnected(); await cad.sendCommand(`(command "_.ARRAY" (handent "${escapeLispString(handle)}") "" "_P" (list ${center.replace(/,/g,' ')}) ${count} ${angle} "")\n`); return mcpSuccess(JSON.stringify({ handle, center, count, angle })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
