<?xml version="1.0" encoding="UTF-8"?>
<!-- StajProject Phase 5 — kalıcı çizimlerin WMS genel gösterimi.
     Stil, kaydedilmiş per-feature değerlerinden okunur; tek tip bir görünüm
     dayatılmaz. Kesik desenler SLD 1.0'da ifade kabul etmediği için
     LineStyle x StrokeWidth kural matrisi olarak yazılır ve dizi değerleri
     frontend'in lineDashFor() hesabıyla birebir aynıdır. -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>drawing_point_presentation</Name>
    <UserStyle>
      <Title>Drawing point presentation</Title>
      <FeatureTypeStyle>
      <Rule>
        <Name>point</Name>
        <PointSymbolizer>
          <Graphic>
            <Mark>
              <WellKnownName>circle</WellKnownName>
              <Fill>
                <CssParameter name="fill">
                  <ogc:Function name="if_then_else">
                    <ogc:Function name="isNull">
                      <ogc:PropertyName>FillColor</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>#7C5CFF</ogc:Literal>
                    <ogc:PropertyName>FillColor</ogc:PropertyName>
                  </ogc:Function>
          </CssParameter>
              </Fill>
              <Stroke>
                <CssParameter name="stroke">
                  <ogc:Function name="if_then_else">
                    <ogc:Function name="isNull">
                      <ogc:PropertyName>StrokeColor</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>#6D4AFF</ogc:Literal>
                    <ogc:PropertyName>StrokeColor</ogc:PropertyName>
                  </ogc:Function>
          </CssParameter>
                <CssParameter name="stroke-width">
                  <ogc:Function name="min">
                    <ogc:Function name="if_then_else">
                      <ogc:Function name="isNull">
                        <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
                      </ogc:Function>
                      <ogc:Literal>3</ogc:Literal>
                      <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Function name="round">
                      <ogc:Div>
                        <ogc:Function name="if_then_else">
                          <ogc:Function name="isNull">
                            <ogc:PropertyName>PointRadius</ogc:PropertyName>
                          </ogc:Function>
                          <ogc:Literal>7</ogc:Literal>
                          <ogc:PropertyName>PointRadius</ogc:PropertyName>
                        </ogc:Function>
                        <ogc:Literal>2.0</ogc:Literal>
                      </ogc:Div>
                    </ogc:Function>
                  </ogc:Function>
                </CssParameter>
              </Stroke>
            </Mark>
            <Size>
              <ogc:Mul>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="isNull">
                    <ogc:PropertyName>PointRadius</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>7</ogc:Literal>
                  <ogc:PropertyName>PointRadius</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>2</ogc:Literal>
              </ogc:Mul>
            </Size>
          </Graphic>
        </PointSymbolizer>
      </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
