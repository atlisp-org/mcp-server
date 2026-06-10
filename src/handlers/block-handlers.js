import { cad } from '../cad.js';
import { mcpSuccess, mcpError, escapeLispString, getNotifyProgress } from '../handler-utils.js';

export async function createBlock(name, entities) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (not (tblsearch "BLOCK" "${escapeLispString(name)}"))
            (progn
                (entmake
                    (list
                        (cons 0 "BLOCK")
                        (cons 70 0)
                        (cons 2 "${escapeLispString(name)}")
                        (cons 10 (list 0 0 0))
                    )
                )
                ${entities}
                (entmake (list (cons 0 "ENDBLK")))
                "CREATED"
            )
            "EXISTS"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'CREATED' || result === '"CREATED"') {
            return { content: [{ type: 'text', text: `已创建块: ${name}` }] };
        }
        if (result === 'EXISTS' || result === '"EXISTS"') {
            return { content: [{ type: 'text', text: `块已存在: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `创建失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function insertBlock(blockName, point, scale = 1, rotation = 0) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const coords = Array.isArray(point) ? point : point.split(',').map(s => parseFloat(s.trim()));
    if (coords.length < 2) {
        return { content: [{ type: 'text', text: '插入点格式错误，需要 x,y 或 [x,y,z]' }], isError: true };
    }
    const [x, y, z = 0] = coords;

    const code = `(progn
        (vl-load-com)
        (if (tblsearch "BLOCK" "${escapeLispString(blockName)}")
            (progn
                (command "._INSERT" "${escapeLispString(blockName)}" (list ${x} ${y} ${z}) ${scale} ${rotation} 0 "")
                "INSERTED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'INSERTED' || result === '"INSERTED"') {
            return { content: [{ type: 'text', text: `已插入块: ${blockName}` }] };
        }
        return { content: [{ type: 'text', text: `插入失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getBlocks() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (setq blocks nil)
        (while (setq blk (tblnext "BLOCK" (null blocks)))
            (setq blocks (cons (cdr (assoc 2 blk)) blocks))
        )
        (reverse blocks)
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (!result || result === 'nil') {
            return { content: [{ type: 'text', text: '当前图形中没有块定义' }] };
        }
        return { content: [{ type: 'text', text: result }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function batchGetBlockAttributes(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return mcpError('未连接 CAD');
  try {
    const filter = args.filter || '';
    const blockName = args.blockName || '';
    const lay = args.layer || '';
    let lispFilter = '(ssget "_X" ';
    const flist = [];
    if (blockName) flist.push(`(cons 2 "${escapeLispString(blockName)}")`);
    if (lay) flist.push(`(cons 8 "${escapeLispString(lay)}")`);
    flist.push('(cons 0 "INSERT")');
    lispFilter += `(list ${flist.join(' ')})`;

    const code = `(progn
  (vl-load-com)
  (setq ss ${lispFilter})
  (setq result nil)
  (if ss
    (progn
      (vlax-for blk (vla-get-activeselectionset
        (vla-get-activedocument (vlax-get-acad-object)))
        (setq atts nil
              atts-raw (vlax-invoke blk 'GetAttributes))
        (if atts-raw
          (foreach a atts-raw
            (setq atts (cons (list (cons "tag" (vla-get-tagstring a))
                                   (cons "value" (vla-get-textstring a))
                                   (cons "handle" (vla-get-handle a))) atts)))
        )
        (setq result (cons (list (cons "handle" (vla-get-handle blk))
                                  (cons "blockName" (vla-get-name blk))
                                  (cons "layer" (vla-get-layer blk))
                                  (cons "attributes" atts)) result))
      )
    )
  )
  (if result (vl-princ-to-string result) "[]")
)`;
    const result = await cad.sendCommandWithResult(code);
    return mcpSuccess(result || '[]');
  } catch (e) {
    return mcpError(`批量获取块属性失败: ${e.message}`);
  }
}

export async function batchSetBlockAttributes(args) {
  if (!cad.connected) { await cad.connect(); }
  if (!cad.connected) return mcpError('未连接 CAD');
  try {
    const items = args.items || [];
    let totalOk = 0;
    let totalFail = 0;
    const total = items.length;
    for (let idx = 0; idx < total; idx++) {
      const item = items[idx];
      const np = getNotifyProgress();
      if (np) np(idx + 1, total, `正在处理块 ${idx + 1}/${total}`);
      try {
        const handle = item.handle;
        const attrs = item.attributes || {};
        for (const [tag, value] of Object.entries(attrs)) {
          await cad.sendCommandWithResult(
            `(progn
  (vl-load-com)
  (if (setq ent (handent "${escapeLispString(handle)}"))
    (progn
      (setq vobj (vlax-ename->vla-object ent))
      (setq atts (vlax-invoke vobj 'GetAttributes))
      (if atts
        (foreach a atts
          (if (= (vla-get-tagstring a) "${escapeLispString(tag)}")
            (vla-put-textstring a "${escapeLispString(String(value))}")
          )
        )
      )
      (princ "ok")
    )
    (princ "nf")
  )
)`
          );
        }
        totalOk++;
      } catch (e) {
        totalFail++;
      }
    }
    const msg = `批量设置块属性完成: 成功 ${totalOk}, 失败 ${totalFail}`;
    if (totalFail > 0) return mcpError(msg);
    return mcpSuccess(msg);
  } catch (e) {
    return mcpError(`批量设置块属性失败: ${e.message}`);
  }
}

export async function explodeBlock(handle) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };

    const code = `(progn
        (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
            (progn
                (command "._EXPLODE" (ssadd ent (ssadd)))
                "EXPLODED"
            )
            "NOTFOUND"
        )
    )`;
    try {
        const result = await cad.sendCommandWithResult(code);
        if (result === 'EXPLODED' || result === '"EXPLODED"') {
            return { content: [{ type: 'text', text: `已炸开块: ${handle}` }] };
        }
        return { content: [{ type: 'text', text: `操作失败: ${result}` }], isError: true };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}