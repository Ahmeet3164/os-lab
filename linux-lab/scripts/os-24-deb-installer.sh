#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Kullanim: $0 paket.deb" 
    exit 1
fi

DEB_FILE="$1"

if [ ! -f "$DEB_FILE" ]; then
     echo "Hata: Dosya bulunamadi: $DEB_FILE"
     exit 1
fi

if [[ "$DEB_FILE" != *.deb ]]; then
     echo "Hata: Dosya .deb uzantili almali"
     exit 1
fi

if !  dpkg-deb --info "$DEB_FILE" > /dev/null 2>&1; then
    echo "Hata? Gecersiz deb paketi"
     exit 1
fi
