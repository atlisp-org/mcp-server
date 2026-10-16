import { cad } from '../cad.js';
import { mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';

function esc(s) {
  return escapeLispString(String(s));
}

function lispPoint(pt) {
  if (!pt || pt === '0,0,0') return '(list 0 0 0)';
  const parts = pt.split(',').map(Number);
  return `(list ${parts[0] || 0} ${parts[1] || 0} ${parts[2] || 0})`;
}

export async function attachXref(args) {
  try {
    const path = esc(args.path);
    const point = lispPoint(args.point);
    const scale = args.scale || 1;
    const rotation = args.rotation || 0;
    const overlay = args.overlay ? '_O' : '_A';
    await cad.sendCommandWithResult(
      `(command "_.XATTACH" "${path}" "${overlay}" "${point}" "${scale}" "${rotation}") (princ)`
    );
    return mcpSuccess(`外部参照已附着: ${args.path}`);
  } catch (e) {
    return mcpError(`附着外部参照失败: ${e.message}`);
  }
}

export async function detachXref(args) {
  try {
    const name = esc(args.name);
    await cad.sendCommand(
      `(command "_.XREF" "_D" "${name}" "") (princ)`
    );
    return mcpSuccess(`外部参照已拆离: ${args.name}`);
  } catch (e) {
    return mcpError(`拆离外部参照失败: ${e.message}`);
  }
}

export async function reloadXref(args) {
  try {
    const name = esc(args.name);
    await cad.sendCommand(
      `(command "_.XREF" "_R" "${name}" "") (princ)`
    );
    return mcpSuccess(`外部参照已重载: ${args.name}`);
  } catch (e) {
    return mcpError(`重载外部参照失败: ${e.message}`);
  }
}

export async function unloadXref(args) {
  try {
    const name = esc(args.name);
    await cad.sendCommand(
      `(command "_.XREF" "_U" "${name}" "") (princ)`
    );
    return mcpSuccess(`外部参照已卸载: ${args.name}`);
  } catch (e) {
    return mcpError(`卸载外部参照失败: ${e.message}`);
  }
}

export async function listXrefs() {
  try {
    const result = await cad.sendCommandWithResult(
      `(progn
  (setq xrefs (vla-get-blocks (vla-get-activedocument (vlax-get-acad-object))))
  (setq res nil)
  (vlax-for b xrefs
    (if (and (= (vla-get-isxref b) :vlax-true) (/= (vla-get-name b) "*U*"))
      (setq res (cons
        (list
          (cons "name" (vla-get-name b))
          (cons "path" (vla-get-path b))
          (cons "xref" T)
        )
        res)
      )
    )
  )
  (if res (vl-princ-to-string res) "[]")
)`
    );
    return mcpSuccess(result || '[]');
  } catch (e) {
    return mcpError(`获取外部参照列表失败: ${e.message}`);
  }
}

export async function bindXref(args) {
  try {
    const name = esc(args.name);
    const bindType = args.bindType === 'insert' ? '_I' : '_B';
    await cad.sendCommand(
      `(command "_.XREF" "_B" "${name}" "${bindType}") (princ)`
    );
    return mcpSuccess(`外部参照已绑定: ${args.name}`);
  } catch (e) {
    return mcpError(`绑定外部参照失败: ${e.message}`);
  }
}

export async function clipXref(args) {
  try {
    const name = esc(args.name);
    const pts = String(args.points).trim();
    await cad.sendCommandWithResult(
      `(command "_.XCLIP" "_N" "${name}" "_P" "_P" "${pts}" "") (princ)`
    );
    return mcpSuccess(`外部参照已裁剪: ${args.name}`);
  } catch (e) {
    return mcpError(`裁剪外部参照失败: ${e.message}`);
  }
}

export async function pathXref(args) {
  try {
    const name = esc(args.name);
    const newPath = esc(args.newPath);
    const result = await cad.sendCommandWithResult(
      `(progn
  (setq blocks (vla-get-blocks (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for b blocks
    (if (and (= (vla-get-isxref b) :vlax-true) (= (vla-get-name b) "${name}"))
      (progn
        (vla-put-path b "${newPath}")
        (vla-reload b)
        (princ "ok")
      )
    )
  )
  (princ "not found")
)`
    );
    if (result.includes('ok')) {
      return mcpSuccess(`外部参照路径已更新: ${args.name} → ${args.newPath}`);
    }
    return mcpError(`未找到外部参照: ${args.name}`);
  } catch (e) {
    return mcpError(`修改外部参照路径失败: ${e.message}`);
  }
}

export async function xrefNotifications(args) {
  try {
    const val = args.enable;
    if (val === undefined || val === null) {
      const result = await cad.sendCommandWithResult(`(getvar "XREFNOTIFY")`);
      const current = parseInt(result?.trim() || '0');
      return mcpSuccess(JSON.stringify({
        enabled: current > 0,
        value: current,
        balloonNotification: current === 2
      }));
    }
    const newVal = val === true ? 1 : val === false ? 0 : Number(val);
    await cad.sendCommand(`(setvar "XREFNOTIFY" ${newVal})`);
    return mcpSuccess(JSON.stringify({ enabled: newVal > 0, value: newVal }));
  } catch (e) {
    return mcpError(`设置外部参照通知失败: ${e.message}`);
  }
}

export async function xrefCompare(args) {
  try {
    const xrefName = esc(args.xrefName || '');
    const handle = esc(args.handle || '');
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq blocks (vla-get-blocks doc))
  (setq target nil)
  (vlax-for b blocks
    (if (or ${xrefName ? `(= (vla-get-name b) "${xrefName}")` : 'nil'} ${handle ? `(= (vla-get-handle b) "${handle}")` : 'nil'})
      (setq target b)
    )
  )
  (if (and target (= (vla-get-isxref target) :vlax-true))
    (progn
      (setq ents nil)
      (vlax-for e target
        (setq ents (cons (list
          (cons "handle" (vla-get-handle e))
          (cons "type" (vla-get-objectname e))
        ) ents))
      )
      (princ (vl-princ-to-string (list
        (cons "name" (vla-get-name target))
        (cons "path" (vla-get-path target))
        (cons "loaded" (vla-get-isloaded target))
        (cons "entities" (reverse ents))
      )))
    )
    (princ "null")
  )
)`);
    if (result === 'null' || !result) {
      return mcpError(`外部参照未找到: ${args.xrefName || args.handle}`);
    }
    return mcpSuccess(result);
  } catch (e) {
    return mcpError(`比较外部参照失败: ${e.message}`);
  }
}

export async function xrefConvertToBlock(args) {
  try {
    const xrefName = esc(args.xrefName || args.handle || '');
    const bindType = args.bindType === 'insert' ? 1 : 0;
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq blocks (vla-get-blocks doc))
  (setq done nil)
  (vlax-for b blocks
    (if (and (= (vla-get-isxref b) :vlax-true) (= (vla-get-name b) "${xrefName}"))
      (progn
        (vla-bind b ${bindType})
        (setq done T)
      )
    )
  )
  (princ (if done "ok" "not found"))
)`);
    if (result && result.trim() === 'ok') {
      return mcpSuccess(JSON.stringify({
        name: args.xrefName || args.handle,
        converted: true,
        bindType: bindType === 0 ? 'bind' : 'insert'
      }));
    }
    return mcpError(`未找到外部参照: ${xrefName}`);
  } catch (e) {
    return mcpError(`转换外部参照为块失败: ${e.message}`);
  }
}

export async function xrefDemote(args) {
  try {
    const parentXref = esc(args.parentXref || '');
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq blocks (vla-get-blocks doc))
  (setq parent nil)
  (vlax-for b blocks
    (if (or (= (vla-get-name b) "${parentXref}") (= (vla-get-handle b) "${parentXref}"))
      (setq parent b)
    )
  )
  (if (and parent (= (vla-get-isxref parent) :vlax-true))
    (progn
      (setq demoted nil)
      (vlax-for e parent
        (if (= (vla-get-objectname e) "AcDbBlockReference")
          (progn
            (setq refName (vla-get-name e))
            (setq refBlock (vlax-catch-apply (function (lambda (n) (vla-item blocks n))) (list refName)))
            (if (and refBlock (= (vla-get-isxref refBlock) :vlax-true))
              (progn
                (setq already nil)
                (vlax-for b2 blocks
                  (if (and (= (vla-get-isxref b2) :vlax-true) (= (vla-get-name b2) refName) (not (eq b2 parent)))
                    (setq already T)
                  )
                )
                (if (not already)
                  (progn
                    (command "_.XREF" "_A" (vla-get-path refBlock) "0,0,0" "1" "0")
                    (setq demoted (cons refName demoted))
                  )
                )
              )
            )
          )
        )
      )
      (princ (vl-princ-to-string (list (cons "demoted" (reverse demoted)))))
    )
    (princ "null")
  )
)`);
    if (result === 'null' || !result) {
      return mcpError(`父外部参照未找到或不是外部参照: ${args.parentXref}`);
    }
    return mcpSuccess(result);
  } catch (e) {
    return mcpError(`降级外部参照失败: ${e.message}`);
  }
}

export async function xrefPathRelative(args) {
  try {
    const names = args.xrefNames;
    const isAll = names === 'all';
    const nameList = isAll ? [] : (Array.isArray(names) ? names : [names]);
    const nameListStr = nameList.map(n => `"${esc(n)}"`).join(' ');

    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object)))
  (setq blocks (vla-get-blocks doc))
  (setq dwgPrefix (getvar "DWGPREFIX"))
  (setq results nil)
  (vlax-for b blocks
    (if (and (= (vla-get-isxref b) :vlax-true)
             (or ${isAll ? 'T' : `(member (vla-get-name b) (list ${nameListStr}))`}))
      (progn
        (setq curPath (vla-get-path b))
        (setq name (vla-get-name b))
        (setq dwgDir (vl-string-right-trim "\\\\/" (strcase dwgPrefix)))
        (setq xp (strcase curPath))
        (if (and (> (strlen xp) (strlen dwgDir)) (= (substr xp 1 (strlen dwgDir)) dwgDir))
          (progn
            (setq newPath (strcat ".\\\\" (substr xp (+ (strlen dwgDir) 2))))
            (vla-put-path b newPath)
            (vla-reload b)
          )
          (setq newPath curPath)
        )
        (setq results (cons (list (cons "name" name) (cons "oldPath" curPath) (cons "newPath" newPath)) results))
      )
    )
  )
  (princ (vl-princ-to-string (reverse results)))
)`);
    return mcpSuccess(result || '[]');
  } catch (e) {
    return mcpError(`转换外部参照路径为相对路径失败: ${e.message}`);
  }
}
