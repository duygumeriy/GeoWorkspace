<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED FILE — DO NOT EDIT MANUALLY
     Source: PoiCategoryTaxonomy.All
     Generator: StajProject.GeoServerStyleGenerator

     Kategori : Araç Kiralama
     Slug     : arac-kiralama
     Simge    : car-front
     Renk     : #8B5CF6

     ÖDEV ŞARTI: "Her bir POI kategorisi için GeoServer'da ayrı bir
     Style (SLD)". Bu dosya o şartın arac-kiralama karşılığıdır.

     EŞLEŞME SLUG İLEDİR, kimlik ya da ad ile DEĞİL: kategori kimliği
     ortama özgüdür ve başka bir veritabanında başka bir kategoriyi
     gösterirdi; görünen ad ise yönetim ekranından düzenlenebilir ve bir
     yeniden adlandırma bu kuralı sessizce sahipsiz bırakırdı. -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>poi_arac-kiralama</Name>
    <UserStyle>
      <Title>POI — Araç Kiralama</Title>
      <Abstract>kategori_slug = 'arac-kiralama' POI'leri; yakın ölçekte isim etiketi.</Abstract>
      <FeatureTypeStyle>
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
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
