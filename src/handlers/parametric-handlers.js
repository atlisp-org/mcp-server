import { cad } from '../cad.js';
import { mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';

function esc(s) {
  return escapeLispString(String(s || ''));
}

export async function getDynamicBlockProperties(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq result nil)
          (foreach p dynProps
            (setq allowed (vl-catch-all-apply 'vlax-invoke (list p 'GetAllowedValues)))
            (if (vl-catch-all-error-p allowed) (setq allowed nil))
            (setq result (cons (list
              (cons "propertyName" (vla-get-propertyname p))
              (cons "value" (vl-princ-to-string (vla-get-value p)))
              (cons "typeCode" (vla-get-propertytype p))
              (cons "allowedValues" (if allowed (vl-princ-to-string allowed) nil))
            ) result))
          )
          (vl-princ-to-string (reverse result))
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    return mcpSuccess(result);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function setDynamicBlockProperty(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const propName = esc(args.propertyName);
    const value = esc(args.value);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq found nil)
          (foreach p dynProps
            (if (= (strcase (vla-get-propertyname p)) (strcase "${propName}"))
              (progn
                (setq numVal (distof "${value}" 2))
                (if numVal
                  (vla-put-value p numVal)
                  (vla-put-value p "${value}")
                )
                (setq found T)
              )
            )
          )
          (vla-update vobj)
          (if found "ok" "PropertyNotFound")
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess(`属性 ${args.propertyName} 已设置为 ${args.value}`);
    return mcpError(`设置失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function getBlockParameters(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq result nil)
          (foreach p dynProps
            (setq tc (vla-get-propertytype p))
            (if (>= tc 3)
              (progn
                (setq allowed (vl-catch-all-apply 'vlax-invoke (list p 'GetAllowedValues)))
                (if (vl-catch-all-error-p allowed) (setq allowed nil))
                (setq result (cons (list
                  (cons "parameterName" (vla-get-propertyname p))
                  (cons "value" (vl-princ-to-string (vla-get-value p)))
                  (cons "typeCode" tc)
                  (cons "allowedValues" (if allowed (vl-princ-to-string allowed) nil))
                ) result))
              )
            )
          )
          (vl-princ-to-string (reverse result))
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    return mcpSuccess(result);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function setBlockParameter(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const paramName = esc(args.parameterName);
    const value = esc(args.value);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq found nil)
          (foreach p dynProps
            (if (and (>= (vla-get-propertytype p) 3)
                     (= (strcase (vla-get-propertyname p)) (strcase "${paramName}")))
              (progn
                (setq numVal (distof "${value}" 2))
                (if numVal
                  (vla-put-value p numVal)
                  (vla-put-value p "${value}")
                )
                (setq found T)
              )
            )
          )
          (vla-update vobj)
          (if found "ok" "ParameterNotFound")
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess(`参数 ${args.parameterName} 已设置为 ${args.value}`);
    return mcpError(`设置失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function listVisibilityStates(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq visProp nil)
          (foreach p dynProps
            (if (= (strcase (vla-get-propertyname p)) "VISIBILITY")
              (setq visProp p)
            )
          )
          (if visProp
            (progn
              (setq allowed (vl-catch-all-apply 'vlax-invoke (list visProp 'GetAllowedValues)))
              (if (vl-catch-all-error-p allowed) (setq allowed nil))
              (setq current (vl-princ-to-string (vla-get-value visProp)))
              (setq states nil)
              (foreach s allowed
                (setq states (cons (list
                  (cons "name" s)
                  (cons "isActive" (= (strcase (vl-princ-to-string s)) (strcase current)))
                ) states))
              )
              (vl-princ-to-string (reverse states))
            )
            "NoVisibilityProperty"
          )
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    return mcpSuccess(result);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}

export async function setVisibilityState(args) {
  try {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
    const handle = esc(args.blockHandle);
    const stateName = esc(args.stateName);
    const code = `(progn
  (vl-load-com)
  (if (setq ent (handent "${handle}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq dynProps (vl-catch-all-apply 'vlax-invoke (list vobj 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p dynProps)
        "NotDynamicBlock"
        (progn
          (setq visProp nil)
          (foreach p dynProps
            (if (= (strcase (vla-get-propertyname p)) "VISIBILITY")
              (setq visProp p)
            )
          )
          (if visProp
            (progn
              (vla-put-value visProp "${stateName}")
              (vla-update vobj)
              "ok"
            )
            "NoVisibilityProperty"
          )
        )
      )
    )
    "EntityNotFound"
  )
)`;
    const result = await cad.sendCommandWithResult(code);
    if (result === 'ok') return mcpSuccess(`可见性状态已切换为: ${args.stateName}`);
    return mcpError(`设置失败: ${result}`);
  } catch (e) {
    return mcpError(`错误: ${e.message}`);
  }
}
