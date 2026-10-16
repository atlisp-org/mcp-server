import { cad } from '../cad.js';
import { error as logError } from '../logger.js';

import { mcpSuccess, mcpError, ensureCadConnected, escapeLispString } from '../handler-utils.js';

export async function createSheetSet(name, description = '') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ss (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (setq newSheetSet (vla-add ss "${escapeLispString(name)}"))
  (vla-put-description newSheetSet "${escapeLispString(description)}")
  (princ (vla-get-name newSheetSet))
)`);
    return mcpSuccess(JSON.stringify({ name, description, created: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function openSheetSet(filePath) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (setq sheetSet (vla-open ssMgr "${escapeLispString(filePath)}"))
  (princ (vla-get-name sheetSet))
)`);
    return mcpSuccess(JSON.stringify({ filePath, name: result, opened: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listSheetSets() {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))) result nil)
  (vlax-for ss ssMgr (setq result (cons (vla-get-name ss) result)))
  (princ (vl-prin1-to-string (reverse result)))
)`);
    let sets = [];
    if (result && result !== 'nil') { try { sets = JSON.parse(result); } catch { sets = []; } }
    return mcpSuccess(JSON.stringify({ sheetSets: sets }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function addSheet(sheetSetName, sheetName, layoutName = 'Model') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (progn (setq sheet (vla-add (vla-get-sheets ss) "${escapeLispString(sheetName)}" "${escapeLispString(layoutName)}")) (princ (vla-get-name sheet)))
    )
  )
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, layoutName, added: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listSheets(sheetSetName) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (progn
        (setq sheets nil)
        (vlax-for sheet (vla-get-sheets ss) (setq sheets (cons (list (vla-get-name sheet) (vla-get-layout sheet)) sheets)))
        (princ (vl-prin1-to-string (reverse sheets)))
      )
    )
  )
)`);
    let sheets = [];
    if (result && result !== 'nil') { try { sheets = JSON.parse(result); } catch { sheets = []; } }
    return mcpSuccess(JSON.stringify({ sheetSetName, sheets, count: sheets.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function deleteSheet(sheetSetName, sheetName) {
  try {
    await ensureCadConnected();
    await cad.sendCommand(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for sheet (vla-get-sheets ss)
        (if (= (vla-get-name sheet) "${escapeLispString(sheetName)}") (vla-delete sheet))
      )
    )
  )
  (princ "deleted")
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, deleted: true }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function publishSheetSet(sheetSetName, outputDir, format = 'PDF') {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}") (progn (vla-publish ss "${escapeLispString(outputDir)}") (princ "published"))))
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, outputDir, format, published: !!result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function getSheetSetProperty(sheetSetName, propertyName) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}") (princ (vla-get-${escapeLispString(propertyName)} ss))))
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, propertyName, value: result }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function reorderSheet(sheetSetName, sheetName, newIndex) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for sheet (vla-get-sheets ss)
        (if (= (vla-get-name sheet) "${escapeLispString(sheetName)}")
          (progn (vla-moveto sheet ${parseInt(newIndex, 10)}) (princ "ok"))
        )
      )
    )
  )
  (princ "nf")
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, newIndex, moved: result === 'ok' }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createSubset(sheetSetName, subsetName) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (progn (setq subset (vla-addsubset (vla-get-sheets ss) "${escapeLispString(subsetName)}")) (princ (vla-get-name subset)))
    )
  )
  (princ "nf")
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, subsetName, created: !!result && result !== 'nf' }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function listSubsets(sheetSetName) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))) subsets nil)
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for subset (vla-get-subsets ss)
        (setq subsets (cons (vla-get-name subset) subsets))
      )
    )
  )
  (princ (vl-prin1-to-string (reverse subsets)))
)`);
    let subsets = [];
    if (result && result !== 'nil') { try { subsets = JSON.parse(result); } catch { subsets = []; } }
    return mcpSuccess(JSON.stringify({ sheetSetName, subsets }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function setSheetProperty(sheetSetName, sheetName, propertyName, value) {
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for sheet (vla-get-sheets ss)
        (if (= (vla-get-name sheet) "${escapeLispString(sheetName)}")
          (progn (vlax-put sheet "${escapeLispString(propertyName)}" "${escapeLispString(String(value))}") (princ "ok"))
        )
      )
    )
  )
  (princ "nf")
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, propertyName, value, set: result === 'ok' }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function createSheetSetArchive(sheetSetName, archivePath) {
  try {
    await ensureCadConnected();
    await cad.sendCommand(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}") (vla-archive ss "${escapeLispString(archivePath)}")))
  (princ "archived")
)`);
    return mcpSuccess(JSON.stringify({ sheetSetName, archivePath, archived: true }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sheetSetPublishOptions(args) {
  const { sheetSetName, sheetName, format, pageSetup, plotStamp } = args;
  try {
    await ensureCadConnected();
    const formatNum = format === 'PDF' ? 1 : 2;
    const plotStampVal = plotStamp ? ':vlax-true' : ':vlax-false';
    const lisp = `(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for sheet (vla-get-sheets ss)
        (if (= (vla-get-name sheet) "${escapeLispString(sheetName)}")
          (progn
            ${format ? `(vla-put-DocTypeOverride sheet ${formatNum})` : ';'}
            ${pageSetup ? `(vla-put-PageSetupOverrideName sheet "${escapeLispString(pageSetup)}")` : ';'}
            ${plotStamp !== undefined ? `(vla-put-PlotStampEnabled sheet ${plotStampVal})` : ';'}
            (princ "ok")
          )
        )
      )
    )
  )
  (princ "nf")
)`;
    const result = await cad.sendCommandWithResult(lisp);
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, format, pageSetup, plotStamp, configured: result === 'ok' }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sheetSetTransmit(args) {
  const { sheetSetName, outputPath } = args;
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (progn
        (setq files nil)
        (vlax-for sheet (vla-get-sheets ss)
          (setq dwgPath (vla-get-path sheet))
          (if (and dwgPath (/= dwgPath ""))
            (progn
              (setq files (cons dwgPath files))
              (vl-catch-all-apply
                (function (lambda ()
                  (setq doc (vla-open (vla-get-documents (vlax-get-acad-object)) dwgPath))
                  (vlax-for blk (vla-get-blocks doc)
                    (if (= (vla-get-isxref blk) :vlax-true)
                      (setq files (cons (vla-get-path blk) files))
                    )
                  )
                  (vla-close doc :vlax-false)
                ))
              )
            )
          )
        )
        ${outputPath ? `(vl-catch-all-apply (function (lambda () (vla-archive ss "${escapeLispString(outputPath)}"))))` : ''}
        (princ (vl-prin1-to-string (reverse files)))
      )
    )
  )
  (princ "nil")
)`);
    let files = [];
    if (result && result !== 'nil') {
      try { files = [...new Set(JSON.parse(result))]; } catch { files = []; }
    }
    return mcpSuccess(JSON.stringify({
      sheetSetName, outputPath: outputPath || null, files,
      fileCount: files.length, transmitted: !!outputPath
    }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sheetSetCompare(args) {
  const { sheetSetName1, sheetSetName2 } = args;
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object)))
        s1 nil s2 nil)
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName1)}")
      (vlax-for sheet (vla-get-sheets ss)
        (setq s1 (cons (list (vla-get-name sheet) (vla-get-path sheet) (vla-get-layout sheet)) s1))
      )
    )
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName2)}")
      (vlax-for sheet (vla-get-sheets ss)
        (setq s2 (cons (list (vla-get-name sheet) (vla-get-path sheet) (vla-get-layout sheet)) s2))
      )
    )
  )
  (setq s1 (reverse s1) s2 (reverse s2))
  (setq names1 (mapcar 'car s1) names2 (mapcar 'car s2))
  (setq only1 nil only2 nil)
  (foreach sh s1 (if (not (member (car sh) names2)) (setq only1 (cons sh only1))))
  (foreach sh s2 (if (not (member (car sh) names1)) (setq only2 (cons sh only2))))
  (princ (vl-prin1-to-string (list (reverse only1) (reverse only2))))
)`);
    let parsed = { onlyIn1: [], onlyIn2: [] };
    if (result && result !== 'nil') {
      try {
        const arr = JSON.parse(result);
        parsed = {
          onlyIn1: (arr[0] || []).map(s => ({ name: String(s[0] || ''), path: String(s[1] || ''), layout: String(s[2] || '') })),
          onlyIn2: (arr[1] || []).map(s => ({ name: String(s[0] || ''), path: String(s[1] || ''), layout: String(s[2] || '') }))
        };
      } catch (e) { logError(`图纸集比较数据解析失败: ${e.message}`); }
    }
    return mcpSuccess(JSON.stringify({
      sheetSetName1, sheetSetName2,
      onlyInSheetSet1: parsed.onlyIn1, onlyInSheetSet2: parsed.onlyIn2,
      differenceCount: parsed.onlyIn1.length + parsed.onlyIn2.length
    }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sheetListViews(args) {
  const { sheetSetName, sheetName } = args;
  try {
    await ensureCadConnected();
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object))))
  (vlax-for ss ssMgr
    (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
      (vlax-for sheet (vla-get-sheets ss)
        (if (= (vla-get-name sheet) "${escapeLispString(sheetName)}")
          (progn
            (setq dwgPath (vla-get-path sheet) views nil)
            (vl-catch-all-apply
              (function (lambda ()
                (setq doc (vla-open (vla-get-documents (vlax-get-acad-object)) dwgPath))
                (vlax-for vw (vla-get-views doc)
                  (setq views (cons (list (vla-get-name vw) (vla-get-height vw) (vla-get-width vw)) views))
                )
                (vla-close doc :vlax-false)
              ))
            )
            (princ (vl-prin1-to-string (reverse views)))
          )
        )
      )
    )
  )
  (princ "nil")
)`);
    let views = [];
    if (result && result !== 'nil') {
      try {
        views = JSON.parse(result).map(v => ({ name: String(v[0] || ''), height: v[1], width: v[2] }));
      } catch { views = []; }
    }
    return mcpSuccess(JSON.stringify({ sheetSetName, sheetName, views, count: views.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}

export async function sheetImportLayouts(args) {
  const { sheetSetName, sourceDwg, layoutNames } = args;
  try {
    await ensureCadConnected();
    const filterLayouts = Array.isArray(layoutNames) && layoutNames.length > 0;
    const layoutList = filterLayouts ? layoutNames.map(n => `"${escapeLispString(n)}"`).join(' ') : '';
    const result = await cad.sendCommandWithResult(`(progn
  (vl-load-com)
  (setq srcDoc (vl-catch-all-apply (function (lambda ()
    (vla-open (vla-get-documents (vlax-get-acad-object)) "${escapeLispString(sourceDwg)}")))))
  (if (vl-catch-all-error-p srcDoc)
    (princ "nil")
    (progn
      (setq tgtDoc (vla-get-activedocument (vlax-get-acad-object))
            ssMgr (vla-get-sheetsets (vla-get-activedocument (vlax-get-acad-object)))
            imported nil)
      (vlax-for lay (vla-get-layouts srcDoc)
        (setq layName (vla-get-name lay))
        (if (and (/= layName "Model") ${filterLayouts ? `(member layName '(${layoutList}))` : 't'})
          (vl-catch-all-apply
            (function (lambda ()
              (vla-activate tgtDoc)
              (command "_.LAYOUT" "_C" (strcat (vla-get-name srcDoc) "|" layName) layName)
              (vlax-for ss ssMgr
                (if (= (vla-get-name ss) "${escapeLispString(sheetSetName)}")
                  (setq sheet (vla-add (vla-get-sheets ss) layName layName)
                        imported (cons (list layName (vla-get-name sheet)) imported))
                )
              )
            ))
          )
        )
      )
      (vla-close srcDoc :vlax-false)
      (princ (vl-prin1-to-string (reverse imported)))
    )
  )
)`);
    let imported = [];
    if (result && result !== 'nil') {
      try {
        imported = JSON.parse(result).map(s => ({ layout: String(s[0] || ''), sheet: String(s[1] || '') }));
      } catch { imported = []; }
    }
    return mcpSuccess(JSON.stringify({ sheetSetName, sourceDwg, imported, count: imported.length }));
  } catch (e) { return mcpError(`错误: ${e.message}`); }
}
