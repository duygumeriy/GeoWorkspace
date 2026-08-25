<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED FILE — DO NOT EDIT MANUALLY
     Source: PoiCategoryTaxonomy.All
     Generator: StajProject.GeoServerStyleGenerator

     Kategori : Banka ve ATM
     Slug     : banka-ve-atm
     Simge    : banknote
     Renk     : #06B6D4

     ÖDEV ŞARTI: "Her bir POI kategorisi için GeoServer'da ayrı bir
     Style (SLD)". Bu dosya o şartın banka-ve-atm karşılığıdır.

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
    <Name>poi_banka-ve-atm</Name>
    <UserStyle>
      <Title>POI — Banka ve ATM</Title>
      <Abstract>kategori_slug = 'banka-ve-atm' POI'leri; yakın ölçekte isim etiketi.</Abstract>
      <FeatureTypeStyle>
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
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
