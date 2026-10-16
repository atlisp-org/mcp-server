export const ENTITY_PROPERTIES_LISP = `
(defun entity:to-list (val)
  (cond
    ((= (type val) 'VARIANT) (entity:to-list (vlax-variant-value val)))
    ((= (type val) 'SAFEARRAY) (vlax-safearray->list val))
    (1 val)))

(defun entity:try-get (obj names / result val)
  (foreach name names
    (if (not (vl-catch-all-error-p
               (setq val (vl-catch-all-apply
                            (function vlax-get-property)
                            (list obj name)))))
      (setq result (cons (cons name (entity:to-list val)) result))))
  (reverse result))

(setq *common-props* '(ObjectName Handle Layer Color Linetype LinetypeScale Lineweight Visibility Material))

(setq *entity-props*
  '((AcDbLine StartPoint EndPoint Angle Delta Length Thickness Normal)
    (AcDbCircle Center Radius Diameter Circumference Area Thickness Normal)
    (AcDbArc Center Radius StartAngle EndAngle TotalAngle ArcLength Area Normal)
    (AcDbPoint Position Thickness Normal)
    (AcDbText TextString Position Height Width ObliqueAngle Rotation StyleName HorizontalAlignment VerticalAlignment Normal Backward UpsideDown)
    (AcDbMText TextString Location Height Width Rotation StyleName AttachmentPoint DrawingDirection LinespacingFactor LinespacingDistance LinespacingStyle FlowDirection)
    (AcDbBlockReference Name InsertionPoint Rotation XScale YScale ZScale Normal)
    (AcDbPolyline Coordinates Closed ConstantWidth Elevation Normal Thickness LinetypeGeneration Area Length)
    (AcDb2dPolyline Coordinates Closed Elevation Normal Thickness LinetypeGeneration Area Length Type Width)
    (AcDb3dPolyline Coordinates Closed Type Normal Length Area)
    (AcDbAlignedDimension DimLinePoint1 DimLinePoint2 ExtLinePoint1 ExtLinePoint2 TextPosition TextRotation Measurement)
    (AcDbRotatedDimension DimLinePoint1 DimLinePoint2 ExtLinePoint1 ExtLinePoint2 TextPosition TextRotation Measurement Rotation)
    (AcDbRadialDimension Center Diameter LeaderLength TextPosition)
    (AcDbDiametricDimension Center Diameter LeaderLength TextPosition)
    (AcDbAngularDimension AngleVertex AngleEndPoint ArcPoint TextPosition Measurement)
    (AcDbHatch PatternName PatternType Area Elevation Normal NumberOfLoops AssociativeHatch HatchObjectType PatternAngle PatternScale PatternSpace ISOPenWidth)
    (AcDbSpline Degree NumberOfControlPoints NumberOfFitPoints ControlPoints FitPoints Knots Weights Area Length Closed Periodic StartTanVector EndTanVector Elevation Normal)
    (AcDbEllipse Center MajorRadius MinorRadius RadiusRatio StartAngle EndAngle Area Circumference Normal)
    (AcDbRegion Area Perimeter Centroid MomentsOfInertia PrincipalMoments PrincipalDirections Normal)
    (AcDb3dSolid Volume Area Centroid MomentsOfInertia PrincipalMoments PrincipalDirections)
    (AcDbRasterImage ImageFile ImageWidth ImageHeight Origin Rotation Width Height ShowImage ClippingEnabled)
    (AcDbLeader Coordinates ArrowheadType ArrowheadSize Color ScaleFactor StyleName TextString TextPosition Type Normal)
    (AcDbViewport Center Width Height ScaleFactor CustomScale StandardScale GridOn SnapOn On DisplayLocked)
    (AcDbTable TableStyleName Position Rows Columns Direction FlowDirection)))

(defun entity:properties (ent / obj object-name result)
  (setq obj (if (= (type ent) 'VLA-OBJECT) ent (vlax-ename->vla-object ent)))
  (setq result (entity:try-get obj *common-props*))
  (setq object-name (cdr (assoc 'ObjectName result)))
  (if object-name
    (setq result (append result (entity:try-get obj (cdr (assoc (read object-name) *entity-props*))))))
  result)
`;

export const VLA_HELPER_LISP = `(defun @:get-props (obj prop-names / result p p-sym val)
  (setq result nil)
  (foreach p prop-names
    (setq p-sym (read p))
    (if (vlax-property-available-p obj p-sym)
      (progn
        (setq val (vl-catch-all-apply 'vlax-get (list obj p-sym)))
        (if (not (vl-catch-all-error-p val))
          (progn
             (cond
              ((= (type val) 'VLA-OBJECT) (setq val (strcat "@" (vla-get-objectname val))))
              ((or (= (type val) 'STR) (= (type val) 'SAFEARRAY) (listp val)) (setq val (vl-prin1-to-string val))))
            (setq result (cons (cons p val) result)))))))
  (reverse result))`;
