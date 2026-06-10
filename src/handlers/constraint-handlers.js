import { cad } from '../cad.js';
import { mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';

function esc(s) {
  return escapeLispString(String(s || ''));
}

function ptStr(pt) {
  if (!pt) return '';
  const parts = String(pt).split(',').map(Number);
  return `(list ${parts[0] || 0} ${parts[1] || 0} ${parts[2] || 0})`;
}

export async function addGeomConstraint(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const ctype = esc(args.type);
    const h1 = esc(args.handle1);
    const h2 = esc(args.handle2 || '');
    const p1 = ptStr(args.point1);
    const p2 = ptStr(args.point2);

    const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq assm (vla-get-associativeconstraints doc))
  (setq e1 (handent "${h1}"))
  ${h2 ? `(setq e2 (handent "${h2}"))` : '(setq e2 nil)'}
  (if e1
    (progn
      (setq vobj1 (vlax-ename->vla-object e1))
      ${h2 ? '(setq vobj2 (vlax-ename->vla-object e2))' : '(setq vobj2 nil)'}
      (vlax-invoke assm 'AddConstraint "${ctype}" vobj1 ${h2 ? 'vobj2' : 'nil'} ${p1 || 'nil'} ${p2 || 'nil'})
      (princ "ok")
    )
    (princ "nf")
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess(`几何约束已添加: ${ctype}`);
    return mcpError(`添加约束失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function addDimConstraint(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const ctype = esc(args.type);
    const h = esc(args.handle);
    const val = parseFloat(args.value) || 0;
    const p1 = ptStr(args.point1);
    const p2 = ptStr(args.point2);

    const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq assm (vla-get-associativeconstraints doc))
  (setq e (handent "${h}"))
  (if e
    (progn
      (setq vobj (vlax-ename->vla-object e))
      (setq dim (vlax-invoke assm 'AddDimConstraint "${ctype}" vobj ${p1 || 'nil'} ${p2 || 'nil'} nil nil ${val} nil))
      (princ "ok")
    )
    (princ "nf")
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess(`标注约束已添加: ${ctype} = ${val}`);
    return mcpError(`添加标注约束失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function delConstraint(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const h = esc(args.handle);
    const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq assm (vla-get-associativeconstraints doc))
  (setq e (handent "${h}"))
  (if e
    (progn
      (setq vobj (vlax-ename->vla-object e))
      (vlax-invoke assm 'DeleteConstraintsOnObject vobj)
      (princ "ok")
    )
    (princ "nf")
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess('约束已删除');
    return mcpError(`删除约束失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function listConstraints() {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const code = `(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq assm (vla-get-associativeconstraints doc))
  (setq result nil)
  (vlax-for c (vla-get-constraints assm)
    (setq result (cons (list
      (cons "type" (vla-get-constrainttype c))
      (cons "expression" (vla-get-expression c))
      (cons "value" (vla-get-value c))
    ) result))
  )
  (if result (vl-princ-to-string result) "[]")
)`;
    const result = await cad.sendCommandWithResult(code);
    return mcpSuccess(result || '[]');
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}
