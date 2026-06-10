import { cad } from '../cad.js';
import { log } from '../logger.js';
import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

export async function createDimensionStyle(name, color = 'bylayer', arrow = 'ClosedFilled', textStyle = '') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (command "_.dimstyle" "s" "${escapeLispString(name)}")
  (command "_.dimstyle" "c" "${escapeLispString(color)}" "_.dimstyle" "a" "${escapeLispString(arrow)}")
  (if (> (strlen "${escapeLispString(textStyle)}") 0) (command "_.dimstyle" "t" "${escapeLispString(textStyle)}"))
  (princ "${escapeLispString(name)}")
)`);
    return mcpSuccess(JSON.stringify({ name, color, arrow, textStyle, created: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function setDimensionStyleVariable(styleName, variable, value) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (command "_.dimstyle" "s" "${escapeLispString(styleName)}")
  (command "_.dimstyle" "${escapeLispString(variable)}" "${escapeLispString(value)}")
  (princ "ok")
)`);
    return mcpSuccess(JSON.stringify({ styleName, variable, value, set: result?.includes('ok') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listDimensionStyles() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq styles nil)
  (while (setq x (tblnext "dimstyle" (null styles)))
    (setq styles (cons (cdr (assoc 2 x)) styles)))
  (princ (vl-prin1-to-string (reverse styles)))
)`);
    let styles = [];
    if (result && result !== 'nil') { try { styles = JSON.parse(result); } catch { styles = result.replace(/[()]/g, '').split(' ').filter(Boolean); } }
    return mcpSuccess(JSON.stringify({ styles, count: styles.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function getDimensionStyleVariable(styleName, variable) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (command "_.dimstyle" "s" "${escapeLispString(styleName)}")
  (command "_.dimstyle" "${escapeLispString(variable)}")
  (princ "done")
)`);
    return mcpSuccess(JSON.stringify({ styleName, variable, value: result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createTextStyle(name, fontFile, height = 0, width = 1, angle = 0) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (command "_.style" "${escapeLispString(name)}" "${escapeLispString(fontFile)}" "${height}" "${width}" "${angle}" "n" "n")
  (princ "${escapeLispString(name)}")
)`);
    return mcpSuccess(JSON.stringify({ name, fontFile, height, width, angle, created: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listTextStyles() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq styles nil)
  (while (setq x (tblnext "style" (null styles)))
    (setq styles (cons (cdr (assoc 2 x)) styles)))
  (princ (vl-prin1-to-string (reverse styles)))
)`);
    let styles = [];
    if (result && result !== 'nil') { try { styles = JSON.parse(result); } catch { styles = []; } }
    return mcpSuccess(JSON.stringify({ styles, count: styles.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createLinetype(name, description, pattern) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.linetype" "c" "${escapeLispString(name)}" "${escapeLispString(description)}" "${escapeLispString(pattern)}" "")`); return mcpSuccess(JSON.stringify({ name, description })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function loadLinetype(linetypeName, filePath) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.linetype" "l" "${escapeLispString(linetypeName)}" "${escapeLispString(filePath)}")`); return mcpSuccess(JSON.stringify({ linetypeName, filePath })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listLinetypes() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq lts nil)
  (while (setq x (tblnext "ltype" (null lts)))
    (setq lts (cons (cdr (assoc 2 x)) lts)))
  (princ (vl-prin1-to-string (reverse lts)))
)`);
    let linetypes = [];
    if (result && result !== 'nil') { try { linetypes = JSON.parse(result); } catch { linetypes = []; } }
    return mcpSuccess(JSON.stringify({ linetypes, count: linetypes.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createMLeaderStyle(name) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq mls (vla-get-mleaderstyles (vla-get-activedocument (vlax-get-acad-object))))
  (vla-add mls "${escapeLispString(name)}")
  (princ "${escapeLispString(name)}")
)`);
    return mcpSuccess(JSON.stringify({ name, created: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function setMLeaderStyleProperty(styleName, property, value) {
  try {
    await ensureCadConnected();
    const valStr = typeof value === 'string' ? `"${escapeLispString(value)}"` : String(value);
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq mls (vla-get-mleaderstyles (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for style mls (if (= (vla-get-name style) "${escapeLispString(styleName)}") (setf (vla-get-${escapeLispString(property)} style) ${valStr})))
  (princ "ok")
)`);
    return mcpSuccess(JSON.stringify({ styleName, property, value, set: result?.includes('ok') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listMLeaderStyles() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq mls (vla-get-mleaderstyles (vla-get-activedocument (vlax-get-acad-object))) styles nil)
  (vlax-for style mls (setq styles (cons (vla-get-name style) styles)))
  (princ (vl-prin1-to-string (reverse styles)))
)`);
    let styles = [];
    if (result && result !== 'nil') { try { styles = JSON.parse(result); } catch { styles = []; } }
    return mcpSuccess(JSON.stringify({ styles, count: styles.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createCloudLine(startPoint, endPoint, bulge = 1, arcRadius = 0) {
  try { await ensureCadConnected(); const start = Array.isArray(startPoint) ? startPoint.join(' ') : startPoint; const end = Array.isArray(endPoint) ? endPoint.join(' ') : endPoint; await cad.sendCommand(`(command "_.revcloud" "${escapeLispString(start)}" "${escapeLispString(end)}" "${bulge}" "")`); return mcpSuccess(JSON.stringify({ startPoint: start, endPoint: end, bulge })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function convertToCloudLine(handle) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.revcloud" (handent "${escapeLispString(handle)}") "")`); return mcpSuccess(JSON.stringify({ handle, converted: true })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function setCloudLineStyle(bulgeFactor = 1, arcRadius = 0.5) {
  try { await ensureCadConnected(); await cad.sendCommand(`(setvar "revcldbulge" ${bulgeFactor})`); return mcpSuccess(JSON.stringify({ bulgeFactor, arcRadius })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createMultileaderStyle(name) { return await createMLeaderStyle(name); }
export async function setMultileaderStyleProperty(styleName, property, value) { return await setMLeaderStyleProperty(styleName, property, value); }
export async function listMultileaderStyles() { return await listMLeaderStyles(); }
