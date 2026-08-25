#!/usr/bin/env bash
#
# StajProject — üretilmiş POI simgelerini GeoServer veri dizinine kopyalar.
#
# GELİŞTİRİCİ ARACI. Otomatik ÇALIŞMAZ; elle çağrılır.
#
# NEDEN YALNIZCA SİMGELER:
#   Simge kurulumu dosya kopyalamadan ibarettir ve Faz 3A'da canlı olarak
#   doğrulanmıştır (pill.svg bu yolla yerleşti ve ExternalGraphic çözümlendi).
#   STİL KAYDI ise GeoServer REST sözleşmesini gerektirir; bu depoda REST
#   kullanan tek bir örnek ya da doğrulanmış tek bir uç yoktur, dolayısıyla
#   burada tahmin edilmez. Stiller elle kaydedilir —
#   bkz. docs/geoserver-poi-read.md.
#
# KİMLİK BİLGİSİ TAŞIMAZ ve istemez: yalnızca bir dizin yolu alır.
#
# Kullanım:
#   GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh
#   GEOSERVER_DATA_DIR=... ./geoserver/sync-icons.sh --apply
#
# Varsayılan KURU ÇALIŞMADIR (dry run): ne yapacağını yazar, hiçbir şeye
# dokunmaz. Yazmak için --apply gerekir.

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/icons"
APPLY=0

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "Bilinmeyen argüman: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${GEOSERVER_DATA_DIR:-}" ]]; then
  cat >&2 <<'USAGE'
GEOSERVER_DATA_DIR tanımlı değil.

Veri dizinini GeoServer arayüzünde şurada görebilirsiniz:
  About & Status -> Server Status -> Data directory

Örnek:
  GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh
USAGE
  exit 2
fi

if [[ ! -d "$GEOSERVER_DATA_DIR" ]]; then
  echo "GEOSERVER_DATA_DIR bir dizin değil: $GEOSERVER_DATA_DIR" >&2
  exit 2
fi

# Stiller simgelere './icons/<ad>.svg' ile başvurur ve GeoServer bunu styles
# dizinine GÖRE çözer; hedef bu yüzden styles/icons olmak zorundadır.
STYLES_DIR="$GEOSERVER_DATA_DIR/styles"
TARGET_DIR="$STYLES_DIR/icons"

if [[ ! -d "$STYLES_DIR" ]]; then
  echo "GeoServer styles dizini bulunamadı: $STYLES_DIR" >&2
  echo "GEOSERVER_DATA_DIR doğru mu?" >&2
  exit 2
fi

count=$(find "$SOURCE_DIR" -maxdepth 1 -name '*.svg' | wc -l | tr -d ' ')

echo "kaynak : $SOURCE_DIR ($count svg)"
echo "hedef  : $TARGET_DIR"

if [[ "$APPLY" -ne 1 ]]; then
  echo
  echo "KURU ÇALIŞMA — hiçbir dosya yazılmadı. Uygulamak için --apply ekleyin."
  exit 0
fi

mkdir -p "$TARGET_DIR"

# Yalnızca .svg kopyalanır ve yalnızca bu dizine yazılır. Hedefte silme
# YAPILMAZ: orada bu üretecin bilmediği başka simgeler olabilir.
find "$SOURCE_DIR" -maxdepth 1 -name '*.svg' -exec cp {} "$TARGET_DIR/" \;

echo "$count simge kopyalandı."
echo
echo "Sıradaki adım stillerin kaydıdır ve ELLE yapılır:"
echo "  docs/geoserver-poi-read.md -> 'Stilleri kaydetme'"
