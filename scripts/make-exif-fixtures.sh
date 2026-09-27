#!/usr/bin/env bash
# Regenerates src/test-fixtures/gps.{jpg,heic,png}: synthetic 96x64 gradients with a
# FAKE GPS position (12°34'56"N 65°43'21"E), Orientation=6 and Make=SyntheticCam.
# Requires ImageMagick 7 (with HEIC write) and exiv2. Never use real photos here.
set -euo pipefail
cd "$(dirname "$0")/../src/test-fixtures"
magick -size 96x64 gradient:blue-yellow -quality 90 gps.jpg
exiv2 -M"set Exif.Image.Make SyntheticCam" -M"set Exif.Image.Orientation 6" \
  -M"set Exif.GPSInfo.GPSVersionID 2 3 0 0" \
  -M"set Exif.GPSInfo.GPSLatitudeRef N" -M"set Exif.GPSInfo.GPSLatitude 12/1 34/1 56/1" \
  -M"set Exif.GPSInfo.GPSLongitudeRef E" -M"set Exif.GPSInfo.GPSLongitude 65/1 43/1 21/1" gps.jpg
magick gps.jpg gps.heic
magick gps.jpg gps.png
