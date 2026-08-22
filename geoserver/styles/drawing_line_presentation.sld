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
    <Name>drawing_line_presentation</Name>
    <UserStyle>
      <Title>Drawing line presentation</Title>
      <FeatureTypeStyle>
      <Rule>
        <Name>dashed-1</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>1</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">1</CssParameter>
            <CssParameter name="stroke-dasharray">10 7</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-2</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>2</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">2</CssParameter>
            <CssParameter name="stroke-dasharray">10 7</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-3</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>3</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">3</CssParameter>
            <CssParameter name="stroke-dasharray">10 7</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-4</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>4</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">4</CssParameter>
            <CssParameter name="stroke-dasharray">13 9</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-5</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>5</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">5</CssParameter>
            <CssParameter name="stroke-dasharray">17 12</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-6</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>6</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">6</CssParameter>
            <CssParameter name="stroke-dasharray">20 14</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-7</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>7</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">7</CssParameter>
            <CssParameter name="stroke-dasharray">23 16</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-8</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>8</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">8</CssParameter>
            <CssParameter name="stroke-dasharray">27 19</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-9</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>9</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">9</CssParameter>
            <CssParameter name="stroke-dasharray">30 21</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-10</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>10</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">10</CssParameter>
            <CssParameter name="stroke-dasharray">33 23</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-11</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>11</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">11</CssParameter>
            <CssParameter name="stroke-dasharray">37 26</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashed-12</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashed</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>12</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">12</CssParameter>
            <CssParameter name="stroke-dasharray">40 28</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-1</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>1</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">1</CssParameter>
            <CssParameter name="stroke-dasharray">1 6</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-2</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>2</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">2</CssParameter>
            <CssParameter name="stroke-dasharray">1 6</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-3</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>3</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">3</CssParameter>
            <CssParameter name="stroke-dasharray">1 6</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-4</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>4</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">4</CssParameter>
            <CssParameter name="stroke-dasharray">1 8</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-5</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>5</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">5</CssParameter>
            <CssParameter name="stroke-dasharray">2 10</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-6</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>6</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">6</CssParameter>
            <CssParameter name="stroke-dasharray">2 12</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-7</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>7</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">7</CssParameter>
            <CssParameter name="stroke-dasharray">2 14</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-8</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>8</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">8</CssParameter>
            <CssParameter name="stroke-dasharray">3 16</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-9</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>9</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">9</CssParameter>
            <CssParameter name="stroke-dasharray">3 18</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-10</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>10</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">10</CssParameter>
            <CssParameter name="stroke-dasharray">3 20</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-11</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>11</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">11</CssParameter>
            <CssParameter name="stroke-dasharray">4 22</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dotted-12</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dotted</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>12</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">12</CssParameter>
            <CssParameter name="stroke-dasharray">4 24</CssParameter>
            <CssParameter name="stroke-linecap">round</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-1</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>1</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">1</CssParameter>
            <CssParameter name="stroke-dasharray">12 6 1 6</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-2</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>2</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">2</CssParameter>
            <CssParameter name="stroke-dasharray">12 6 1 6</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-3</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>3</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">3</CssParameter>
            <CssParameter name="stroke-dasharray">12 6 1 6</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-4</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>4</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">4</CssParameter>
            <CssParameter name="stroke-dasharray">16 8 1 8</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-5</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>5</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">5</CssParameter>
            <CssParameter name="stroke-dasharray">20 10 2 10</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-6</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>6</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">6</CssParameter>
            <CssParameter name="stroke-dasharray">24 12 2 12</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-7</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>7</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">7</CssParameter>
            <CssParameter name="stroke-dasharray">28 14 2 14</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-8</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>8</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">8</CssParameter>
            <CssParameter name="stroke-dasharray">32 16 3 16</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-9</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>9</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">9</CssParameter>
            <CssParameter name="stroke-dasharray">36 18 3 18</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-10</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>10</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">10</CssParameter>
            <CssParameter name="stroke-dasharray">40 20 3 20</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-11</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>11</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">11</CssParameter>
            <CssParameter name="stroke-dasharray">44 22 4 22</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>dashdot-12</Name>
        <ogc:Filter>
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>LineStyle</ogc:PropertyName>
              <ogc:Literal>dashdot</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              <ogc:Literal>12</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
        <LineSymbolizer>
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
            <CssParameter name="stroke-width">12</CssParameter>
            <CssParameter name="stroke-dasharray">48 24 4 24</CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      <Rule>
        <Name>solid</Name>
        <ElseFilter/>
        <LineSymbolizer>
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
              <ogc:Function name="if_then_else">
                <ogc:Function name="isNull">
                  <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>3</ogc:Literal>
                <ogc:PropertyName>StrokeWidth</ogc:PropertyName>
              </ogc:Function>
          </CssParameter>
          </Stroke>
        </LineSymbolizer>
      </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
