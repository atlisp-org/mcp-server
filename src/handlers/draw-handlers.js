import { cad } from '../cad.js';
import { withCadConnection, mcpSuccess, escapeLispString } from '../handler-utils.js';

export const drawLine = withCadConnection(async (p1, p2) => {
    await cad.sendCommand(`(command "_.LINE" "${escapeLispString(p1)}" "${escapeLispString(p2)}" "")`);
    return mcpSuccess(`已绘制直线: ${p1} → ${p2}`);
});

export const drawCircle = withCadConnection(async (center, radius) => {
    await cad.sendCommand(`(command "_.CIRCLE" "${escapeLispString(center)}" ${radius})`);
    return mcpSuccess(`已绘制圆: 圆心 ${center}，半径 ${radius}`);
});

export const drawArc = withCadConnection(async (center, radius, startAngle, endAngle) => {
    const code = `(progn
            (setq cen (list ${center}))
            (setq r ${radius})
            (setq ang1 (* pi (/ ${startAngle} 180.0)))
            (setq ang2 (* pi (/ ${endAngle} 180.0)))
            (command "_.ARC" "C" cen (polar cen ang1 r) (polar cen ang2 r))
        )`;
    await cad.sendCommand(code);
    return mcpSuccess(`已绘制圆弧: 圆心 ${center}，半径 ${radius}，角度 ${startAngle}°→${endAngle}°`);
});

export const drawRectangle = withCadConnection(async (corner1, corner2) => {
    await cad.sendCommand(`(command "_.RECTANG" "${escapeLispString(corner1)}" "${escapeLispString(corner2)}")`);
    return mcpSuccess(`已绘制矩形: ${corner1} — ${corner2}`);
});

export const drawPolygon = withCadConnection(async (center, sides, radius) => {
    await cad.sendCommand(`(command "_.POLYGON" ${sides} "${escapeLispString(center)}" "I" ${radius})`);
    return mcpSuccess(`已绘制正${sides}边形: 中心 ${center}，半径 ${radius}`);
});

export const drawEllipse = withCadConnection(async (center, majorAxis, minorAxis) => {
    await cad.sendCommand(`(command "_.ELLIPSE" "C" "${escapeLispString(center)}" "${escapeLispString(majorAxis)}" "${escapeLispString(minorAxis)}")`);
    return mcpSuccess(`已绘制椭圆: 中心 ${center}`);
});

export const drawText = withCadConnection(async (text, point, height) => {
    const h = height || 2.5;
    await cad.sendCommand(`(command "_.TEXT" "${escapeLispString(point)}" ${h} "0" "${escapeLispString(text)}")`);
    return mcpSuccess(`已创建单行文字: "${text}"`);
});

export const drawMtext = withCadConnection(async (text, point, width) => {
    const w = width || 0;
    await cad.sendCommand(`(command "_.MTEXT" "${escapeLispString(point)}" "W" ${w} "${escapeLispString(text)}" "")`);
    return mcpSuccess(`已创建多行文字: "${text}"`);
});

export const drawPolyline = withCadConnection(async (points, closed) => {
    const pts = points.split(/\s+/).filter(Boolean);
    const pointArgs = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
    const closeArg = closed ? ' "C"' : ' ""';
    await cad.sendCommand(`(command "_.PLINE" ${pointArgs}${closeArg})`);
    return mcpSuccess(`已创建多段线: ${pts.length} 个顶点`);
});

export const drawSpline = withCadConnection(async (points) => {
    const pts = points.split(/\s+/).filter(Boolean);
    const pointArgs = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
    await cad.sendCommand(`(command "_.SPLINE" ${pointArgs} "" "" "")`);
    return mcpSuccess(`已创建样条曲线: ${pts.length} 个控制点`);
});

export const drawPoint = withCadConnection(async (point) => {
    await cad.sendCommand(`(command "_.POINT" "${escapeLispString(point)}")`);
    return mcpSuccess(`已创建点: ${point}`);
});

export const drawHatch = withCadConnection(async (points, pattern) => {
    const pat = pattern || 'ANSI31';
    const pts = points.split(/\s+/).filter(Boolean);
    const lispPts = `(list ${pts.map(p => `(list ${p})`).join(' ')})`;
    const boundaryCode = `(progn
            (setq pts ${lispPts})
            (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(100 . "AcDbPolyline")
                (cons 90 ${pts.length}) '(70 . 1)
                (cons 10 (nth 0 pts)) (cons 10 (nth 1 pts))
            ))
        )`;
    await cad.sendCommand(boundaryCode);
    await cad.sendCommand(`(command "_.HATCH" "${escapeLispString(pat)}" "" "")`);
    return mcpSuccess(`已创建图案填充: ${pat}`);
});

export const drawHelix = withCadConnection(async (center, topRadius, bottomRadius, height, turns = 3) => {
    await cad.sendCommand(`(command "_.HELIX" "${escapeLispString(center)}" ${bottomRadius} ${topRadius} ${height} ${turns})`);
    return mcpSuccess(`已创建螺旋: 中心 ${center}，半径 ${bottomRadius}→${topRadius}，高度 ${height}，${turns} 圈`);
});

export const drawDonut = withCadConnection(async (center, innerRadius, outerRadius) => {
    await cad.sendCommand(`(command "_.DONUT" ${innerRadius} ${outerRadius} "${escapeLispString(center)}" "")`);
    return mcpSuccess(`已绘制圆环: 中心 ${center}，内径 ${innerRadius}，外径 ${outerRadius}`);
});

export const draw2dSolid = withCadConnection(async (p1, p2, p3, p4) => {
    await cad.sendCommand(`(command "_.SOLID" "${escapeLispString(p1)}" "${escapeLispString(p2)}" "${escapeLispString(p3)}" "${escapeLispString(p4)}" "")`);
    return mcpSuccess(`已创建 2D 实体: ${p1} ${p2} ${p3} ${p4}`);
});

export const drawXline = withCadConnection(async (point, direction) => {
    await cad.sendCommand(`(command "_.XLINE" "${escapeLispString(point)}" "${escapeLispString(direction)}")`);
    return mcpSuccess(`已创建构造线: 经过 ${point}，方向 ${direction}`);
});

export const drawRay = withCadConnection(async (point, direction) => {
    await cad.sendCommand(`(command "_.RAY" "${escapeLispString(point)}" "${escapeLispString(direction)}")`);
    return mcpSuccess(`已创建射线: 起点 ${point}，方向 ${direction}`);
});

export const drawLeader = withCadConnection(async (points, annotation) => {
    const pts = points.split(/\s+/).filter(Boolean);
    const cmds = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
    if (annotation) {
        await cad.sendCommand(`(command "_.LEADER" ${cmds} "" "${escapeLispString(annotation)}" "")`);
    } else {
        await cad.sendCommand(`(command "_.LEADER" ${cmds} "" "" "")`);
    }
    return mcpSuccess(`已创建引线标注: ${points}`);
});

export const drawTable = withCadConnection(async (insertionPoint, rows, columns, rowHeight = 10, colWidth = 20) => {
    await cad.sendCommand(`(command "_.TABLE" "${escapeLispString(insertionPoint)}" ${columns} ${rows} ${rowHeight} ${colWidth})`);
    return mcpSuccess(`已创建表格: ${insertionPoint}，${rows}×${columns}`);
});
