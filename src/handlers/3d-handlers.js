import { cad } from '../cad.js';
import { log } from '../logger.js';
import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

function parsePoint(point) {
  if (Array.isArray(point)) return point.join(' ');
  if (typeof point === 'string') return point;
  return '0,0,0';
}

export async function createBox(center, length, width, height) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.box" "${escapeLispString(pt)}" "${length}" "${width}" "${height}" "")`); return mcpSuccess(JSON.stringify({ center: pt, dimensions: { length, width, height } })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createSphere(center, radius) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.sphere" "${escapeLispString(pt)}" "${radius}" "")`); return mcpSuccess(JSON.stringify({ center: pt, radius })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createCylinder(center, radius, height) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.cylinder" "${escapeLispString(pt)}" "${radius}" "${height}" "")`); return mcpSuccess(JSON.stringify({ center: pt, radius, height })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createCone(center, radius, height) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.cone" "${escapeLispString(pt)}" "${radius}" "${height}" "")`); return mcpSuccess(JSON.stringify({ center: pt, radius, height })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createTorus(center, majorRadius, minorRadius) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.torus" "${escapeLispString(pt)}" "${majorRadius}" "${minorRadius}" "")`); return mcpSuccess(JSON.stringify({ center: pt, majorRadius, minorRadius })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createWedge(center, length, width, height) {
  try { await ensureCadConnected(); const pt = parsePoint(center); await cad.sendCommand(`(command "_.wedge" "${escapeLispString(pt)}" "${length}" "${width}" "${height}" "")`); return mcpSuccess(JSON.stringify({ center: pt, dimensions: { length, width, height } })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function create3DFace(points) {
  try { await ensureCadConnected(); const ptList = Array.isArray(points) ? points.join(' ') : points; await cad.sendCommand(`(command "_.3dface" ${ptList} "")`); return mcpSuccess(JSON.stringify({ points })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createMesh(rows, columns, points) {
  try { await ensureCadConnected(); const ptList = typeof points === 'string' ? points : (Array.isArray(points) ? points.join(' ') : points); await cad.sendCommand(`(command "_.mesh" "${rows}" "${columns}" ${ptList} "")`); return mcpSuccess(JSON.stringify({ rows, columns })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function extrudeSolid(profileHandle, height, taperAngle = 0) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.extrude" (handent "${escapeLispString(profileHandle)}") "${height}" "${taperAngle}" "")`); return mcpSuccess(JSON.stringify({ profileHandle, height, taperAngle })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function revolveSolid(profileHandle, axisStart, axisEnd, angle = 360) {
  try { await ensureCadConnected(); const startPt = parsePoint(axisStart); const endPt = parsePoint(axisEnd); await cad.sendCommand(`(command "_.revolve" (handent "${escapeLispString(profileHandle)}") "${escapeLispString(startPt)}" "${escapeLispString(endPt)}" "${angle}" "")`); return mcpSuccess(JSON.stringify({ profileHandle, axisStart: startPt, axisEnd: endPt, angle })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function create3DPolyline(points) {
  try { await ensureCadConnected(); const ptList = Array.isArray(points) ? points.map(p => parsePoint(p)).join(' ') : points; await cad.sendCommand(`(command "_.3dpoly" ${ptList} "")`); return mcpSuccess(JSON.stringify({ points })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createRegion(handles) {
  try { await ensureCadConnected(); const handleList = Array.isArray(handles) ? handles : handles.split(',').map(h => h.trim()); const handleStr = handleList.map(h => `(handent "${escapeLispString(h)}")`).join(' '); await cad.sendCommand(`(command "_.region" ${handleStr} "")`); return mcpSuccess(JSON.stringify({ handleCount: handleList.length })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function booleanUnion(handles) {
  try { await ensureCadConnected(); const handleList = Array.isArray(handles) ? handles : handles.split(',').map(h => h.trim()); await cad.sendCommand(`(command "_.union" ${handleList.map(h => `(handent "${escapeLispString(h)}")`).join(' ')} "")`); return mcpSuccess(JSON.stringify({ operation: 'union' })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function booleanSubtract(handles, subtractFromHandles = []) {
  try {
    await ensureCadConnected();
    const handleList = Array.isArray(handles) ? handles : handles.split(',').map(h => h.trim());
    const fromList = subtractFromHandles.length ? (Array.isArray(subtractFromHandles) ? subtractFromHandles : subtractFromHandles.split(',').map(h => h.trim())) : [handleList.shift()];
    const fromStr = fromList.map(h => `(handent "${escapeLispString(h)}")`).join(' ');
    const subtractStr = handleList.map(h => `(handent "${escapeLispString(h)}")`).join(' ');
    await cad.sendCommand(`(command "_.subtract" ${fromStr} "" ${subtractStr} "")`);
    return mcpSuccess(JSON.stringify({ subtractFrom: fromList, subtractThese: handleList }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function booleanIntersect(handles) {
  try { await ensureCadConnected(); const handleList = Array.isArray(handles) ? handles : handles.split(',').map(h => h.trim()); await cad.sendCommand(`(command "_.intersect" ${handleList.map(h => `(handent "${escapeLispString(h)}")`).join(' ')} "")`); return mcpSuccess(JSON.stringify({ operation: 'intersect' })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sliceSolid(solidHandle, planePoint, planeNormal, keepBoth = true) {
  try { await ensureCadConnected(); const pt = parsePoint(planePoint); const normal = parsePoint(planeNormal); const side = keepBoth ? 'Both' : 'No'; await cad.sendCommand(`(command "_.slice" (handent "${escapeLispString(solidHandle)}") "${escapeLispString(pt)}" "${escapeLispString(normal)}" "${side}")`); return mcpSuccess(JSON.stringify({ solidHandle, planePoint: pt, planeNormal: normal, keepBoth })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createLoftSurface(profileHandles, guideHandles = []) {
  try {
    await ensureCadConnected();
    const profileList = Array.isArray(profileHandles) ? profileHandles : profileHandles.split(',').map(h => h.trim());
    const guideList = Array.isArray(guideHandles) ? guideHandles : guideHandles.split(',').map(h => h.trim());
    const cmd = `(progn
  (command "_.loft")
  ${profileList.map(h => `(handent "${escapeLispString(h)}")`).join(' ')}
  ${guideList.length > 0 ? guideList.map(h => `(handent "${escapeLispString(h)}")`).join(' ') : ''}
  ""
)`;
    await cad.sendCommand(cmd);
    return mcpSuccess(JSON.stringify({ profileCount: profileList.length, guideCount: guideList.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function get3DSolidInfo(handle) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (setq ent (handent "${escapeLispString(handle)}"))
  (if ent
    (progn
      (setq vla (vlax-ename->vla-object ent))
      (princ (vl-prin1-to-string (list
        (cons "type" (vla-get-objectname vla))
        (cons "volume" (vla-get-volume vla))
        (cons "surfaceArea" (vla-get-area vla))
      )))
    )
    (princ "nil")
  )
)`);
    let info = {};
    if (result && result !== 'nil') { try { info = JSON.parse(result); } catch { info = {}; } }
    return mcpSuccess(JSON.stringify({ handle, info }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function thickenSurface(surfaceHandle, thickness) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.thicken" (handent "${escapeLispString(surfaceHandle)}") "${thickness}")`); return mcpSuccess(JSON.stringify({ surfaceHandle, thickness })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function offsetSurface(surfaceHandle, distance) {
  try { await ensureCadConnected(); await cad.sendCommand(`(command "_.offset" (handent "${escapeLispString(surfaceHandle)}") "${distance}")`); return mcpSuccess(JSON.stringify({ surfaceHandle, distance })); } catch (e) { return mcpError(`错误: ${e.message}`); }
}
