import { cad } from '../cad.js';
import { escapeLispString } from '../handler-utils.js';

export async function drawLine(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.LINE" "${escapeLispString(params.p1)}" "${escapeLispString(params.p2)}" "")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制直线: ${params.p1} → ${params.p2}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawCircle(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.CIRCLE" "${escapeLispString(params.center)}" ${params.radius})`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制圆: 圆心 ${params.center}，半径 ${params.radius}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawArc(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(progn
            (setq cen (list ${params.center}))
            (setq r ${params.radius})
            (setq ang1 (* pi (/ ${params.startAngle} 180.0)))
            (setq ang2 (* pi (/ ${params.endAngle} 180.0)))
            (command "_.ARC" "C" cen (polar cen ang1 r) (polar cen ang2 r))
        )`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制圆弧: 圆心 ${params.center}，半径 ${params.radius}，角度 ${params.startAngle}°→${params.endAngle}°` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawRectangle(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.RECTANG" "${escapeLispString(params.corner1)}" "${escapeLispString(params.corner2)}")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制矩形: ${params.corner1} — ${params.corner2}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawPolygon(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.POLYGON" ${params.sides} "${escapeLispString(params.center)}" "I" ${params.radius})`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制正${params.sides}边形: 中心 ${params.center}，半径 ${params.radius}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawEllipse(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.ELLIPSE" "C" "${escapeLispString(params.center)}" "${escapeLispString(params.majorAxis)}" "${escapeLispString(params.minorAxis)}")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已绘制椭圆: 中心 ${params.center}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawText(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const h = params.height || 2.5;
        const code = `(command "_.TEXT" "${escapeLispString(params.point)}" ${h} "0" "${escapeLispString(params.text)}")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已创建单行文字: "${params.text}"` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawMtext(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const w = params.width || 0;
        const code = `(command "_.MTEXT" "${escapeLispString(params.point)}" "W" ${w} "${escapeLispString(params.text)}" "")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已创建多行文字: "${params.text}"` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawPolyline(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pts = params.points.split(/\s+/).filter(Boolean);
        const pointArgs = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
        const closeArg = params.closed ? ' "C"' : ' ""';
        const code = `(command "_.PLINE" ${pointArgs}${closeArg})`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已创建多段线: ${pts.length} 个顶点` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawSpline(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pts = params.points.split(/\s+/).filter(Boolean);
        const pointArgs = pts.map(p => `"${escapeLispString(p)}"`).join(' ');
        const code = `(command "_.SPLINE" ${pointArgs} "" "" "")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已创建样条曲线: ${pts.length} 个控制点` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawPoint(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const code = `(command "_.POINT" "${escapeLispString(params.point)}")`;
        await cad.sendCommand(code);
        return { content: [{ type: 'text', text: `已创建点: ${params.point}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function drawHatch(params) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const pattern = params.pattern || 'ANSI31';
        const pts = params.points.split(/\s+/).filter(Boolean);
        const ptList = pts.map(p => { const [x, y] = p.split(','); return `${x} ${y}`; }).join(' ');
        const lispPts = `(list ${pts.map(p => `(list ${p})`).join(' ')})`;
        const code = `(progn
            (setq pts ${lispPts})
            (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(100 . "AcDbPolyline")
                (cons 90 ${pts.length}) '(70 . 1)
                (cons 10 (nth 0 pts)) (cons 10 (nth 1 pts))
            ))
        )`;
        const code2 = `(command "_.HATCH" "${escapeLispString(pattern)}" "" "")`;
        try {
            await cad.sendCommand(code);
            await cad.sendCommand(code2);
        } catch(hErr) {
            return { content: [{ type: 'text', text: `错误: ${hErr.message}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `已创建图案填充: ${pattern}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
