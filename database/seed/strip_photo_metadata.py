"""Re-encode every JPEG in a folder without any metadata, and report which ones had a GPS position.

One-off helper for the demo photos that were uploaded to the plant-photos bucket by hand (see
README.md in this folder). Photos taken in the mobile app don't need it: the app already
re-encodes them before upload (mobile-app/src/lib/photos.js).

    python strip_photo_metadata.py <folder with the downloaded photos> <empty output folder>

- Writes clean copies with the same file names into the output folder. The originals are never
  changed, and the output folder must be a different one.
- The new file is written from the pixels only, so EXIF (GPS, camera, time), XMP, IPTC, ICC
  profiles, comments and embedded thumbnails are all gone. The EXIF rotation is applied to the
  pixels first, so photos don't turn sideways, and an embedded colour profile is converted to
  sRGB first, so colours don't shift.
- Every output file is opened again and checked; any metadata left is reported as an error.
- Files that are not JPEGs (e.g. PNG) are listed as skipped, not cleaned.

Needs Pillow (python -m pip install pillow). Nothing is uploaded and no keys are used.
"""

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

JPEG_SUFFIXES = {".jpg", ".jpeg", ".jpe"}
GPS_IFD = 0x8825
# The plant-photos bucket refuses larger files (database/seed/README.md, step 6)
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
JPEG_QUALITY = 90


def metadata_found(image):
    """Names of the metadata blocks in an opened JPEG, and whether any of them holds a position."""
    found = []
    has_gps = False

    exif = image.getexif()
    if len(exif):
        found.append("EXIF")
        if GPS_IFD in exif or len(exif.get_ifd(GPS_IFD)):
            has_gps = True

    for marker, data in getattr(image, "applist", []):
        if marker == "APP1" and data.startswith(b"http://ns.adobe.com/xap/"):
            found.append("XMP")
            if b"GPSLatitude" in data or b"GPSLongitude" in data:
                has_gps = True
        elif marker == "APP2" and data.startswith(b"ICC_PROFILE"):
            found.append("ICC profile")
        elif marker == "APP2" and data.startswith(b"MPF"):
            found.append("extra images (MPF)")
        elif marker == "APP13":
            found.append("IPTC/Photoshop")
        elif marker == "COM":
            found.append("comment")
        elif marker not in ("APP0", "APP1", "APP14"):
            found.append(marker)

    # Keep the order, drop repeats (an ICC profile can span several APP2 blocks)
    return list(dict.fromkeys(found)), has_gps


def to_srgb(image, warnings):
    icc = image.info.get("icc_profile")
    if not icc:
        return image
    try:
        from PIL import ImageCms

        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        target = ImageCms.createProfile("sRGB")
        return ImageCms.profileToProfile(image, source, target, outputMode="RGB")
    except Exception as error:  # noqa: BLE001 - any failure here only affects colour accuracy
        warnings.append(f"colour profile not converted ({error}); colours may look slightly different")
        return image


def clean_copy(source_path, target_path):
    """Writes the clean copy. Returns (metadata found, had GPS, warnings)."""
    warnings = []
    with Image.open(source_path) as image:
        if image.format != "JPEG":
            raise ValueError(f"not a JPEG (it is {image.format}), skipped")
        image.load()
        found, has_gps = metadata_found(image)

        # Rotation first, while the EXIF orientation is still there to read
        pixels = ImageOps.exif_transpose(image)
        pixels = to_srgb(pixels, warnings)
        if pixels.mode not in ("RGB", "L"):
            pixels = pixels.convert("RGB")

        # A fresh image holding only the pixels, so no metadata can be carried over by save()
        clean = Image.new(pixels.mode, pixels.size)
        clean.paste(pixels)
        clean.save(target_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

    with Image.open(target_path) as written:
        left, left_gps = metadata_found(written)
        if left or left_gps:
            target_path.unlink()
            raise RuntimeError(f"the copy still had metadata ({', '.join(left)}), so it was deleted")

    if target_path.stat().st_size > MAX_UPLOAD_BYTES:
        warnings.append("the copy is over 5 MB, which the plant-photos bucket refuses")
    return found, has_gps, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path, help="folder with the downloaded photos")
    parser.add_argument("output", type=Path, help="folder for the clean copies (created if missing)")
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        sys.exit(f"Not a folder: {source}")
    if output == source:
        sys.exit("The output folder must be different from the source folder.")
    output.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in source.iterdir() if p.is_file())
    with_gps, failed, skipped, cleaned = [], [], [], 0

    for path in files:
        if path.suffix.lower() not in JPEG_SUFFIXES:
            skipped.append(path.name)
            continue
        target = output / path.name
        if target.exists():
            failed.append(path.name)
            print(f"FAILED  {path.name}: already in the output folder, not overwritten")
            continue
        try:
            found, has_gps, warnings = clean_copy(path, target)
        except Exception as error:  # noqa: BLE001 - report and carry on with the next file
            failed.append(path.name)
            print(f"FAILED  {path.name}: {error}")
            continue

        cleaned += 1
        if has_gps:
            with_gps.append(path.name)
        print(f"{'GPS    ' if has_gps else 'ok     '} {path.name}: removed "
              f"{', '.join(found) if found else 'nothing (no metadata)'}")
        for warning in warnings:
            print(f"        warning: {warning}")

    print()
    print(f"{cleaned} JPEG(s) cleaned into {output}")
    print(f"{len(with_gps)} had a GPS position: {', '.join(with_gps) if with_gps else 'none'}")
    if skipped:
        print(f"{len(skipped)} skipped, not JPEG (NOT cleaned): {', '.join(skipped)}")
    if failed:
        print(f"{len(failed)} failed: {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
