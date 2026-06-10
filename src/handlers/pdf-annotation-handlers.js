import { cad } from '../cad.js';
import { log } from '../logger.js';
import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

export async function attachPdf(point, pdfPath, scale = 1, rotation = 0) {
  try { await ensureCadConnected(); const pt = Array.isArray(point) ? point.join(' ') : point; await cad.sendCommand(`(command "_.pdfattach" "${escapeLispString(pdfPath)}" "${escapeLispString(pt)}" "${scale}" "${rotation}")`); return mcpSuccess(JSON.stringify({ pdfPath, point: pt, scale, rotation })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listAttachedPdfs() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq i -1 pdfs nil ss (ssget "X" (list (cons 0 "PDFREFERENCE"))))
  (if ss (repeat (sslength ss) (setq ent (ssname ss (setq i (1+ i))) pdfs (cons (cdr (assoc -1 (entget ent))) pdfs))))
  (princ (vl-prin1-to-string (reverse pdfs)))
)`);
    let handles = [];
    if (result && result !== 'nil') { try { handles = JSON.parse(result); } catch { handles = []; } }
    return mcpSuccess(JSON.stringify({ handles, count: handles.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function reloadPdf(pdfHandle) {
  try { await ensureCadConnected(); const result = await cad.sendCommandWithResult(`(progn (command "_.pdfreload" (handent "${escapeLispString(pdfHandle)}")) (princ "reloaded"))`); return mcpSuccess(JSON.stringify({ handle: pdfHandle, reloaded: result?.includes('reloaded') })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function detachPdf(pdfHandle) {
  try { await ensureCadConnected(); await cad.sendCommand(`(entdel (handent "${escapeLispString(pdfHandle)}"))`); return mcpSuccess(JSON.stringify({ handle: pdfHandle, detached: true })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function getPdfInfo(pdfHandle) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(pdfHandle)}"))
  (if ent (princ (vl-prin1-to-string (list (cons "path" (cdr (assoc 1 (entget ent)))) (cons "name" (cdr (assoc 2 (entget ent))))))) (princ "nil"))
)`);
    let info = {};
    if (result && result !== 'nil') { try { info = JSON.parse(result); } catch { info = {}; } }
    return mcpSuccess(JSON.stringify({ handle: pdfHandle, info }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createDgnUnderlay(dgnPath, point, scale = 1) {
  try { await ensureCadConnected(); const pt = Array.isArray(point) ? point.join(' ') : point; await cad.sendCommand(`(command "_.dgnattach" "${escapeLispString(dgnPath)}" "${escapeLispString(pt)}" "${scale}")`); return mcpSuccess(JSON.stringify({ dgnPath, point: pt, scale })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createDwfUnderlay(dwfPath, point, scale = 1) {
  try { await ensureCadConnected(); const pt = Array.isArray(point) ? point.join(' ') : point; await cad.sendCommand(`(command "_.dwfattach" "${escapeLispString(dwfPath)}" "${escapeLispString(pt)}" "${scale}")`); return mcpSuccess(JSON.stringify({ dwfPath, point: pt, scale })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function importDxf(dxfPath, explode = false) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.dxfin" "${escapeLispString(dxfPath)}" ${explode ? '"explode"' : ''})`); return mcpSuccess(JSON.stringify({ dxfPath, explode })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function importDgn(sourceFile, targetFile = '') {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.dgnin" "${escapeLispString(sourceFile)}" "${escapeLispString(targetFile)}")`); return mcpSuccess(JSON.stringify({ sourceFile, targetFile })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function exportDgn(filePath) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.dgnout" "${escapeLispString(filePath)}")`); return mcpSuccess(JSON.stringify({ filePath })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createHyperlink(handle, url, description = '') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn
    (vla-put-hyperlinks (vlax-ename->vla-object ent) (vlax-add (vla-get-hyperlinks (vlax-ename->vla-object ent)) "${escapeLispString(url)}" "${escapeLispString(description)}"))
    (princ "added")) (princ "nil"))
)`);
    return mcpSuccess(JSON.stringify({ handle, url, description, added: result?.includes('added') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function removeHyperlink(handle) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent (progn (vla-clear (vla-get-hyperlinks (vlax-ename->vla-object ent))) (princ "removed")) (princ "nil"))
)`);
    return mcpSuccess(JSON.stringify({ handle, removed: result?.includes('removed') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function batchAttachPdfs(pdfFiles, basePoint, spacing = 0, direction = 'x') {
  try {
    await ensureCadConnected();
    const results = [];
    const pt = Array.isArray(basePoint) ? basePoint.join(' ') : basePoint;
    for (let i = 0; i < pdfFiles.length; i++) {
      try {
        const offsetX = direction === 'x' ? 0 : spacing * i;
        const offsetY = direction === 'y' ? 0 : spacing * i;
        await cad.sendCommand(`(command "_.pdfattach" "${escapeLispString(pdfFiles[i])}" (getvar "viewctr") "1" "0")`);
        if (spacing > 0 && i > 0) { await cad.sendCommand(`(command "_.move" "l" "" (getvar "viewctr") (list ${offsetX} ${offsetY} 0))`); }
        results.push({ file: pdfFiles[i], success: true });
      } catch (e) { results.push({ file: pdfFiles[i], error: e.message, success: false }); }
    }
    return mcpSuccess(JSON.stringify(results));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function savePdfLayout(layoutName, outputPath, plotDevice = 'DWG to PDF.pc3', paperSize = 'A4') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (command "_.plot" "y" "${escapeLispString(layoutName)}" "${escapeLispString(plotDevice)}" "${escapeLispString(paperSize)}" "Landscape" "n" "n" "n" "n" "n" "${escapeLispString(outputPath)}")
  (princ "saved")
)`);
    return mcpSuccess(JSON.stringify({ layoutName, outputPath, saved: result?.includes('saved') || result?.includes('配置') }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}
