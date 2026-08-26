<?xml version="1.0" encoding="UTF-8"?>
<!--
  Konum Analizi — analiz POI'lerinin nokta örtüsü.

  ELLE YAZILMIŞTIR: POI kategori stillerini üreten StajProject.GeoServerStyleGenerator
  bu dosyanın SAHİBİ DEĞİLDİR (üretim işareti taşımaz, bu yüzden "bayat yapıt"
  olarak silinmez). Ağırlıklı ısı rasteri backend tarafından üretilir.

  Katman: geoworkspace:analysis_poi_read. Isı rasteri aynı mantıksal
  analysis_poi_union kümesini backend sorgusuyla okur.

  SÜZGEÇ BURADA YOKTUR. Hangi kategorilerin ve hangi alanın çizileceği
  backend'in ürettiği CQL_FILTER ile gelir (GeoServerLocationAnalysisImageService).
  Stile bir kategori kuralı yazmak, taksonominin ikinci bir yorumunu üretirdi.

  ÖLÇEK: yarıçap yakınlaştırmayla büyür. Tek bir sabit yarıçap ya il ölçeğinde
  Ankara'yı tek bir dolu lekeye çevirir ya da sokak ölçeğinde görünmez kalırdı.
  Duraklar WMS ölçek paydasına bağlıdır; ara değerler doğrusal geçişlidir.

  KONTRAST: koyu çeper + yarı saydam dolgu. Örtü ısı haritasının ÜSTÜNDE çizilir
  ve rasterin kırmızı bölgelerinde de okunabilir kalmalıdır; düz açık renkli bir
  nokta orada kaybolurdu.

  ETİKET YOKTUR. Binlerce noktanın etiketi okunamaz bir gürültü olurdu.
-->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>analysis_poi_points</Name>
    <UserStyle>
      <Title>Location analysis POI points</Title>
      <Abstract>Konum analiziyle eslesen POI'lerin nokta gosterimi.</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill>
                  <CssParameter name="fill">#1D4ED8</CssParameter>
                  <CssParameter name="fill-opacity">0.75</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">#F8FAFC</CssParameter>
                  <CssParameter name="stroke-width">1.2</CssParameter>
                  <CssParameter name="stroke-opacity">0.95</CssParameter>
                </Stroke>
              </Mark>
              <!--
                Yarıçap ölçeğe göre: il ölçeğinde küçük bir nokta, sokak
                ölçeğinde okunabilir bir işaret. Interpolate ara ölçeklerde
                sıçrama bırakmaz.
              -->
              <Size>
                <ogc:Function name="Interpolate">
                  <ogc:Function name="env">
                    <ogc:Literal>wms_scale_denominator</ogc:Literal>
                    <ogc:Literal>500000</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>5000</ogc:Literal>
                  <ogc:Literal>9</ogc:Literal>
                  <ogc:Literal>50000</ogc:Literal>
                  <ogc:Literal>6</ogc:Literal>
                  <ogc:Literal>250000</ogc:Literal>
                  <ogc:Literal>4</ogc:Literal>
                  <ogc:Literal>1000000</ogc:Literal>
                  <ogc:Literal>3</ogc:Literal>
                  <ogc:Literal>linear</ogc:Literal>
                </ogc:Function>
              </Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
