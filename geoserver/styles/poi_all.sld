<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED FILE — DO NOT EDIT MANUALLY
     Source: PoiCategoryTaxonomy.All
     Generator: StajProject.GeoServerStyleGenerator

     Bileşik POI sunum stili: 44 kanonik kategorinin tamamı.

     Bu stil, kategori başına ayrı stil şartının YERİNE GEÇMEZ — o şart
     poi_<slug>.sld dosyalarıyla karşılanır. Buradaki amaç pratiktir: tek
     bir WMS GetMap isteği 44 stil adı taşıyamaz, dolayısıyla gerçek
     harita sunumu bu stili kullanır. Kurallar kategori stilleriyle AYNI
     şablondan üretilir.

     Kural sırası taksonomi sırasıdır ve deterministiktir. -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>poi_all</Name>
    <UserStyle>
      <Title>POI — tüm kategoriler</Title>
      <Abstract>Kanonik taksonomideki 44 kategorinin tamamı; her biri kendi simgesi, rengi ve etiketiyle.</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <Name>ticaret-alanlari-marker-very-far</Name>
          <Title>Ticaret Alanları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ticaret-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/store.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ticaret-alanlari-marker-medium</Name>
          <Title>Ticaret Alanları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ticaret-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/store.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ticaret-alanlari-marker-near</Name>
          <Title>Ticaret Alanları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ticaret-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/store.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ticaret-alanlari-label</Name>
          <Title>Ticaret Alanları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ticaret-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>alisveris-marker-very-far</Name>
          <Title>Alışveriş (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>alisveris</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-bag.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>alisveris-marker-medium</Name>
          <Title>Alışveriş (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>alisveris</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-bag.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>alisveris-marker-near</Name>
          <Title>Alışveriş (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>alisveris</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-bag.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>alisveris-label</Name>
          <Title>Alışveriş ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>alisveris</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>enerji-uretim-dagitim-marker-very-far</Name>
          <Title>Enerji Üretim ve Dağıtım (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>enerji-uretim-dagitim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/zap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>enerji-uretim-dagitim-marker-medium</Name>
          <Title>Enerji Üretim ve Dağıtım (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>enerji-uretim-dagitim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/zap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>enerji-uretim-dagitim-marker-near</Name>
          <Title>Enerji Üretim ve Dağıtım (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>enerji-uretim-dagitim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/zap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>enerji-uretim-dagitim-label</Name>
          <Title>Enerji Üretim ve Dağıtım ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>enerji-uretim-dagitim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6E4705</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>eglence-yerleri-marker-very-far</Name>
          <Title>Eğlence Yerleri (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eglence-yerleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/party-popper.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eglence-yerleri-marker-medium</Name>
          <Title>Eğlence Yerleri (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eglence-yerleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/party-popper.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eglence-yerleri-marker-near</Name>
          <Title>Eğlence Yerleri (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eglence-yerleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/party-popper.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eglence-yerleri-label</Name>
          <Title>Eğlence Yerleri ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eglence-yerleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6A2045</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>konut-alanlari-marker-very-far</Name>
          <Title>Konut Alanları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konut-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/house.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konut-alanlari-marker-medium</Name>
          <Title>Konut Alanları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konut-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/house.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konut-alanlari-marker-near</Name>
          <Title>Konut Alanları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konut-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/house.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konut-alanlari-label</Name>
          <Title>Konut Alanları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konut-alanlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>kulturel-tesisler-marker-very-far</Name>
          <Title>Kültürel Tesisler (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kulturel-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/landmark.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kulturel-tesisler-marker-medium</Name>
          <Title>Kültürel Tesisler (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kulturel-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/landmark.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kulturel-tesisler-marker-near</Name>
          <Title>Kültürel Tesisler (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kulturel-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/landmark.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kulturel-tesisler-label</Name>
          <Title>Kültürel Tesisler ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kulturel-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#4C266F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>altyapi-hizmetleri-marker-very-far</Name>
          <Title>Su, Kanalizasyon ve Çöp (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>altyapi-hizmetleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/recycle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>altyapi-hizmetleri-marker-medium</Name>
          <Title>Su, Kanalizasyon ve Çöp (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>altyapi-hizmetleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/recycle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>altyapi-hizmetleri-marker-near</Name>
          <Title>Su, Kanalizasyon ve Çöp (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>altyapi-hizmetleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/recycle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>altyapi-hizmetleri-label</Name>
          <Title>Su, Kanalizasyon ve Çöp ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>altyapi-hizmetleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#03525F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>saglik-kurumlari-marker-very-far</Name>
          <Title>Sağlık Kurumları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>saglik-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hospital.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>saglik-kurumlari-marker-medium</Name>
          <Title>Sağlık Kurumları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>saglik-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hospital.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>saglik-kurumlari-marker-near</Name>
          <Title>Sağlık Kurumları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>saglik-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hospital.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>saglik-kurumlari-label</Name>
          <Title>Sağlık Kurumları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>saglik-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6C1F1F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>egitim-kurumlari-marker-very-far</Name>
          <Title>Eğitim Kurumları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>egitim-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/graduation-cap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>egitim-kurumlari-marker-medium</Name>
          <Title>Eğitim Kurumları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>egitim-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/graduation-cap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>egitim-kurumlari-marker-near</Name>
          <Title>Eğitim Kurumları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>egitim-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/graduation-cap.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>egitim-kurumlari-label</Name>
          <Title>Eğitim Kurumları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>egitim-kurumlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6E4705</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>telekomunikasyon-marker-very-far</Name>
          <Title>Telekomünikasyon (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>telekomunikasyon</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/radio-tower.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>telekomunikasyon-marker-medium</Name>
          <Title>Telekomünikasyon (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>telekomunikasyon</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/radio-tower.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>telekomunikasyon-marker-near</Name>
          <Title>Telekomünikasyon (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>telekomunikasyon</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/radio-tower.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>telekomunikasyon-label</Name>
          <Title>Telekomünikasyon ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>telekomunikasyon</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>tarimsal-uretim-marker-very-far</Name>
          <Title>Tarımsal Üretim Alanları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarimsal-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/wheat.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarimsal-uretim-marker-medium</Name>
          <Title>Tarımsal Üretim Alanları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarimsal-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/wheat.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarimsal-uretim-marker-near</Name>
          <Title>Tarımsal Üretim Alanları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarimsal-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/wheat.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarimsal-uretim-label</Name>
          <Title>Tarımsal Üretim Alanları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarimsal-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#0F592A</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>sanayi-uretim-marker-very-far</Name>
          <Title>Sanayi ve Üretim Alanları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sanayi-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/factory.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sanayi-uretim-marker-medium</Name>
          <Title>Sanayi ve Üretim Alanları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sanayi-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/factory.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sanayi-uretim-marker-near</Name>
          <Title>Sanayi ve Üretim Alanları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sanayi-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/factory.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sanayi-uretim-label</Name>
          <Title>Sanayi ve Üretim Alanları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sanayi-uretim</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#171D26</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>yesil-alanlar-marker-very-far</Name>
          <Title>Yeşil Alanlar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yesil-alanlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/trees.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yesil-alanlar-marker-medium</Name>
          <Title>Yeşil Alanlar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yesil-alanlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/trees.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yesil-alanlar-marker-near</Name>
          <Title>Yeşil Alanlar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yesil-alanlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/trees.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#22C55E</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yesil-alanlar-label</Name>
          <Title>Yeşil Alanlar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yesil-alanlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#0F592A</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>karayolu-marker-very-far</Name>
          <Title>Karayolu (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>karayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/route.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>karayolu-marker-medium</Name>
          <Title>Karayolu (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>karayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/route.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>karayolu-marker-near</Name>
          <Title>Karayolu (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>karayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/route.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>karayolu-label</Name>
          <Title>Karayolu ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>karayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>resmi-kurum-marker-very-far</Name>
          <Title>Resmi Kurum (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>resmi-kurum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/building-2.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>resmi-kurum-marker-medium</Name>
          <Title>Resmi Kurum (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>resmi-kurum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/building-2.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>resmi-kurum-marker-near</Name>
          <Title>Resmi Kurum (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>resmi-kurum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/building-2.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>resmi-kurum-label</Name>
          <Title>Resmi Kurum ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>resmi-kurum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#171D26</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>askeri-kurumlar-marker-very-far</Name>
          <Title>Askeri Kurumlar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>askeri-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shield.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>askeri-kurumlar-marker-medium</Name>
          <Title>Askeri Kurumlar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>askeri-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shield.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>askeri-kurumlar-marker-near</Name>
          <Title>Askeri Kurumlar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>askeri-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shield.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>askeri-kurumlar-label</Name>
          <Title>Askeri Kurumlar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>askeri-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#171D26</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>demiryolu-marker-very-far</Name>
          <Title>Demiryolu (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>demiryolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/train.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>demiryolu-marker-medium</Name>
          <Title>Demiryolu (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>demiryolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/train.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>demiryolu-marker-near</Name>
          <Title>Demiryolu (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>demiryolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/train.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>demiryolu-label</Name>
          <Title>Demiryolu ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>demiryolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#171D26</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>finansal-kurumlar-marker-very-far</Name>
          <Title>Finansal Kurumlar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>finansal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/badge-dollar-sign.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>finansal-kurumlar-marker-medium</Name>
          <Title>Finansal Kurumlar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>finansal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/badge-dollar-sign.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>finansal-kurumlar-marker-near</Name>
          <Title>Finansal Kurumlar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>finansal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/badge-dollar-sign.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>finansal-kurumlar-label</Name>
          <Title>Finansal Kurumlar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>finansal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#03525F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>tarihi-turistik-marker-very-far</Name>
          <Title>Tarihi ve Turistik Tesisler (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarihi-turistik</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/castle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarihi-turistik-marker-medium</Name>
          <Title>Tarihi ve Turistik Tesisler (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarihi-turistik</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/castle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarihi-turistik-marker-near</Name>
          <Title>Tarihi ve Turistik Tesisler (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarihi-turistik</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/castle.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>tarihi-turistik-label</Name>
          <Title>Tarihi ve Turistik Tesisler ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>tarihi-turistik</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#4C266F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>onemli-noktalar-marker-very-far</Name>
          <Title>Önemli Noktalar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>onemli-noktalar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/map-pin.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>onemli-noktalar-marker-medium</Name>
          <Title>Önemli Noktalar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>onemli-noktalar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/map-pin.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>onemli-noktalar-marker-near</Name>
          <Title>Önemli Noktalar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>onemli-noktalar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/map-pin.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>onemli-noktalar-label</Name>
          <Title>Önemli Noktalar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>onemli-noktalar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>spor-tesisleri-marker-very-far</Name>
          <Title>Spor Tesisleri (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>spor-tesisleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/dumbbell.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>spor-tesisleri-marker-medium</Name>
          <Title>Spor Tesisleri (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>spor-tesisleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/dumbbell.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>spor-tesisleri-marker-near</Name>
          <Title>Spor Tesisleri (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>spor-tesisleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/dumbbell.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>spor-tesisleri-label</Name>
          <Title>Spor Tesisleri ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>spor-tesisleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>sivil-toplum-marker-very-far</Name>
          <Title>Sivil Toplum Örgütleri (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sivil-toplum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/users.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sivil-toplum-marker-medium</Name>
          <Title>Sivil Toplum Örgütleri (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sivil-toplum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/users.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sivil-toplum-marker-near</Name>
          <Title>Sivil Toplum Örgütleri (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sivil-toplum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/users.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sivil-toplum-label</Name>
          <Title>Sivil Toplum Örgütleri ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sivil-toplum</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#03525F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>sosyal-kurumlar-marker-very-far</Name>
          <Title>Sosyal Amaçlı Kurumlar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sosyal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/heart-handshake.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sosyal-kurumlar-marker-medium</Name>
          <Title>Sosyal Amaçlı Kurumlar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sosyal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/heart-handshake.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sosyal-kurumlar-marker-near</Name>
          <Title>Sosyal Amaçlı Kurumlar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sosyal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/heart-handshake.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>sosyal-kurumlar-label</Name>
          <Title>Sosyal Amaçlı Kurumlar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>sosyal-kurumlar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6A2045</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>yeme-icme-marker-very-far</Name>
          <Title>Yeme-İçme Yerleri (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yeme-icme</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yeme-icme-marker-medium</Name>
          <Title>Yeme-İçme Yerleri (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yeme-icme</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yeme-icme-marker-near</Name>
          <Title>Yeme-İçme Yerleri (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yeme-icme</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yeme-icme-label</Name>
          <Title>Yeme-İçme Yerleri ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yeme-icme</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#70340A</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>dini-tesisler-marker-very-far</Name>
          <Title>Dini Tesisler (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>dini-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/church.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>dini-tesisler-marker-medium</Name>
          <Title>Dini Tesisler (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>dini-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/church.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>dini-tesisler-marker-near</Name>
          <Title>Dini Tesisler (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>dini-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/church.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#A855F7</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>dini-tesisler-label</Name>
          <Title>Dini Tesisler ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>dini-tesisler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#4C266F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>havayolu-marker-very-far</Name>
          <Title>Havayolu (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>havayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/plane.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>havayolu-marker-medium</Name>
          <Title>Havayolu (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>havayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/plane.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>havayolu-marker-near</Name>
          <Title>Havayolu (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>havayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/plane.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>havayolu-label</Name>
          <Title>Havayolu ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>havayolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>denizyolu-marker-very-far</Name>
          <Title>Denizyolu (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>denizyolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/ship.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>denizyolu-marker-medium</Name>
          <Title>Denizyolu (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>denizyolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/ship.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>denizyolu-marker-near</Name>
          <Title>Denizyolu (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>denizyolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/ship.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#3B82F6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>denizyolu-label</Name>
          <Title>Denizyolu ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>denizyolu</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#1B3B6F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>kafe-marker-very-far</Name>
          <Title>Kafe (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kafe</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/coffee.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kafe-marker-medium</Name>
          <Title>Kafe (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kafe</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/coffee.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kafe-marker-near</Name>
          <Title>Kafe (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kafe</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/coffee.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>kafe-label</Name>
          <Title>Kafe ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>kafe</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#70340A</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>restoran-marker-very-far</Name>
          <Title>Restoran (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>restoran</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils-crossed.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>restoran-marker-medium</Name>
          <Title>Restoran (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>restoran</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils-crossed.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>restoran-marker-near</Name>
          <Title>Restoran (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>restoran</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/utensils-crossed.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F97316</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>restoran-label</Name>
          <Title>Restoran ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>restoran</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#70340A</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>konser-alani-marker-very-far</Name>
          <Title>Konser Alanı (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konser-alani</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/music.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konser-alani-marker-medium</Name>
          <Title>Konser Alanı (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konser-alani</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/music.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konser-alani-marker-near</Name>
          <Title>Konser Alanı (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konser-alani</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/music.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EC4899</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>konser-alani-label</Name>
          <Title>Konser Alanı ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>konser-alani</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6A2045</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>banka-ve-atm-marker-very-far</Name>
          <Title>Banka ve ATM (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>banka-ve-atm</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/banknote.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>banka-ve-atm-marker-medium</Name>
          <Title>Banka ve ATM (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>banka-ve-atm</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/banknote.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>banka-ve-atm-marker-near</Name>
          <Title>Banka ve ATM (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>banka-ve-atm</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/banknote.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#06B6D4</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>banka-ve-atm-label</Name>
          <Title>Banka ve ATM ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>banka-ve-atm</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#03525F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>epdk-marker-very-far</Name>
          <Title>EPDK (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>epdk</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/gauge.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>epdk-marker-medium</Name>
          <Title>EPDK (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>epdk</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/gauge.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>epdk-marker-near</Name>
          <Title>EPDK (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>epdk</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/gauge.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#334155</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>epdk-label</Name>
          <Title>EPDK ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>epdk</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#171D26</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>eczane-marker-very-far</Name>
          <Title>Eczane (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eczane</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/pill.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eczane-marker-medium</Name>
          <Title>Eczane (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eczane</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/pill.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eczane-marker-near</Name>
          <Title>Eczane (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eczane</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/pill.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#EF4444</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>eczane-label</Name>
          <Title>Eczane ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>eczane</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6C1F1F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>arac-sarj-istasyonlari-marker-very-far</Name>
          <Title>Araç Şarj İstasyonları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-sarj-istasyonlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/battery-charging.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-sarj-istasyonlari-marker-medium</Name>
          <Title>Araç Şarj İstasyonları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-sarj-istasyonlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/battery-charging.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-sarj-istasyonlari-marker-near</Name>
          <Title>Araç Şarj İstasyonları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-sarj-istasyonlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/battery-charging.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-sarj-istasyonlari-label</Name>
          <Title>Araç Şarj İstasyonları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-sarj-istasyonlari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6E4705</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>okullar-marker-very-far</Name>
          <Title>Okullar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>okullar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/school.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>okullar-marker-medium</Name>
          <Title>Okullar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>okullar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/school.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>okullar-marker-near</Name>
          <Title>Okullar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>okullar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/school.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#F59E0B</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>okullar-label</Name>
          <Title>Okullar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>okullar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#6E4705</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>otomotiv-sektoru-marker-very-far</Name>
          <Title>Otomotiv Sektörü (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>otomotiv-sektoru</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>otomotiv-sektoru-marker-medium</Name>
          <Title>Otomotiv Sektörü (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>otomotiv-sektoru</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>otomotiv-sektoru-marker-near</Name>
          <Title>Otomotiv Sektörü (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>otomotiv-sektoru</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>otomotiv-sektoru-label</Name>
          <Title>Otomotiv Sektörü ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>otomotiv-sektoru</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>mobilyacilar-marker-very-far</Name>
          <Title>Mobilyacılar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>mobilyacilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/armchair.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>mobilyacilar-marker-medium</Name>
          <Title>Mobilyacılar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>mobilyacilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/armchair.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>mobilyacilar-marker-near</Name>
          <Title>Mobilyacılar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>mobilyacilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/armchair.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>mobilyacilar-label</Name>
          <Title>Mobilyacılar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>mobilyacilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>zincir-marketler-marker-very-far</Name>
          <Title>Zincir Marketler (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>zincir-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-cart.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>zincir-marketler-marker-medium</Name>
          <Title>Zincir Marketler (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>zincir-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-cart.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>zincir-marketler-marker-near</Name>
          <Title>Zincir Marketler (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>zincir-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-cart.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>zincir-marketler-label</Name>
          <Title>Zincir Marketler ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>zincir-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>giyim-magazalari-marker-very-far</Name>
          <Title>Giyim Mağazaları (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>giyim-magazalari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shirt.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>giyim-magazalari-marker-medium</Name>
          <Title>Giyim Mağazaları (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>giyim-magazalari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shirt.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>giyim-magazalari-marker-near</Name>
          <Title>Giyim Mağazaları (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>giyim-magazalari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shirt.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>giyim-magazalari-label</Name>
          <Title>Giyim Mağazaları ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>giyim-magazalari</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>elektronik-marketler-marker-very-far</Name>
          <Title>Elektronik Marketler (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>elektronik-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/monitor.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>elektronik-marketler-marker-medium</Name>
          <Title>Elektronik Marketler (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>elektronik-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/monitor.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>elektronik-marketler-marker-near</Name>
          <Title>Elektronik Marketler (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>elektronik-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/monitor.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>elektronik-marketler-label</Name>
          <Title>Elektronik Marketler ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>elektronik-marketler</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>emlakcilar-marker-very-far</Name>
          <Title>Emlakçılar (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>emlakcilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/key-round.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>emlakcilar-marker-medium</Name>
          <Title>Emlakçılar (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>emlakcilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/key-round.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>emlakcilar-marker-near</Name>
          <Title>Emlakçılar (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>emlakcilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/key-round.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>emlakcilar-label</Name>
          <Title>Emlakçılar ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>emlakcilar</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>yapi-marketleri-marker-very-far</Name>
          <Title>Yapı Marketleri (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yapi-marketleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hammer.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yapi-marketleri-marker-medium</Name>
          <Title>Yapı Marketleri (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yapi-marketleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hammer.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yapi-marketleri-marker-near</Name>
          <Title>Yapı Marketleri (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yapi-marketleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/hammer.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>yapi-marketleri-label</Name>
          <Title>Yapı Marketleri ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>yapi-marketleri</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>arac-kiralama-marker-very-far</Name>
          <Title>Araç Kiralama (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-kiralama</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car-front.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-kiralama-marker-medium</Name>
          <Title>Araç Kiralama (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-kiralama</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car-front.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-kiralama-marker-near</Name>
          <Title>Araç Kiralama (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-kiralama</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/car-front.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>arac-kiralama-label</Name>
          <Title>Araç Kiralama ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>arac-kiralama</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
        <Rule>
          <Name>ayakkabi-terlik-canta-marker-very-far</Name>
          <Title>Ayakkabı / Terlik / Çanta (çok uzak)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ayakkabi-terlik-canta</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>1000000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-basket.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>20</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ayakkabi-terlik-canta-marker-medium</Name>
          <Title>Ayakkabı / Terlik / Çanta (orta)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ayakkabi-terlik-canta</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>150000</MinScaleDenominator>
          <MaxScaleDenominator>1000000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-basket.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>24</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ayakkabi-terlik-canta-marker-near</Name>
          <Title>Ayakkabı / Terlik / Çanta (yakın)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ayakkabi-terlik-canta</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>150000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <ExternalGraphic>
                <OnlineResource xlink:type="simple" xlink:href="./icons/shopping-basket.svg"/>
                <Format>image/svg+xml</Format>
              </ExternalGraphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#8B5CF6</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#FFFFFF</CssParameter>
                  <CssParameter name="stroke-width">1.5</CssParameter>
                </Stroke>
              </Mark>
              <Size>30</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Name>ayakkabi-terlik-canta-label</Name>
          <Title>Ayakkabı / Terlik / Çanta ismi</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>kategori_slug</ogc:PropertyName>
              <ogc:Literal>ayakkabi-terlik-canta</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>isim</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Noto Sans</CssParameter>
              <CssParameter name="font-family">DejaVu Sans</CssParameter>
              <CssParameter name="font-family">SansSerif</CssParameter>
              <CssParameter name="font-size">12</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.0</AnchorPointY>
                </AnchorPoint>
                <Displacement>
                  <DisplacementX>0</DisplacementX>
                  <DisplacementY>19</DisplacementY>
                </Displacement>
                <Rotation>0</Rotation>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
                <CssParameter name="fill-opacity">0.85</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#3F296F</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="spaceAround">6</VendorOption>
            <VendorOption name="maxDisplacement">40</VendorOption>
            <VendorOption name="goodnessOfFit">0.5</VendorOption>
          </TextSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
