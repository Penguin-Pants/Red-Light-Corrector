# F4 expected metadata round trips

Draft fixture expectations, independent of browser writer support. Use identical known field values in JPEG, PNG and HEIC sources where their containers permit. Inspect both JPEG and PNG outputs with an independent reader. Any readable field that a candidate writer cannot preserve is a writer gap. Keep the expected result fixed during writer comparison.

| Fixture field or condition | Expected JPEG output | Expected PNG output |
| --- | --- | --- |
| Capture date, subsecond and time-zone offset with deliberately different filesystem time | Preserve the full EXIF capture-time group in APP1. | Preserve the group in an eXIf chunk. |
| Coordinates with south and west references, altitude and altitude reference, GPS time and date | Preserve the EXIF GPS group with signs, reference values and rational values intact. | Preserve the same group in eXIf. |
| Missing GPS or capture offset | Keep the field absent. | Keep the field absent. |
| Camera, lens, exposure and copyright where present | Round-trip supported EXIF fields. | Round-trip supported EXIF fields in eXIf. |
| Rotated or mirrored source, with full-size and reduced-size exports | Normalize pixels upright. Record orientation 1 or equivalent absence. Use final encoded dimensions in retained image-size fields. | Apply the same normalization. Ensure IHDR reflects encoded dimensions. |
| EXIF and XMP have conflicting timestamps or orientation | Record original field provenance. Regenerate or remove stale orientation and size. Require a documented precedence decision for conflicting capture time. | Same expectations, using eXIf and compatible XMP carriage. |
| Authored title, caption and keywords in XMP or IPTC | Preserve compatible values with correct XMP or IPTC carriage and report any representation change. | Preserve compatible values using a standard mapping such as XMP in iTXt. Report unmapped IPTC fields. |
| Tagged input or intentionally converted output | Signal the actual encoded color space. Validate ICC APP2 ordering when present. | Signal the actual encoded color space with consistent PNG profile or standard signaling chunks. |
| Original thumbnails, previews, offset-dependent notes and auxiliary gain maps | Regenerate image-dependent previews or report their removal. Report unsafe or incompatible blocks individually. | Same policy. Validate any preserved auxiliary data independently. |
| Oversized or corrupt metadata | Produce a valid file with an explicit per-field reason for omissions. Never truncate a field or segment silently. | Produce a valid file with an explicit per-field reason for omissions. Bound compressed metadata handling. |

Use generated coordinates and timestamps. Include inputs with tags that are both missing and present. Compare metadata with ExifTool, confirm actual encoded geometry by reopening outputs and compare color independently under F7. Reject a candidate that reports success after silently losing a required compatible field.

Standards and inspection references. [CIPA Exif standards](https://www.cipa.jp/e/std/std-sec.html), [PNG eXIf](https://www.w3.org/TR/png-3/#eXIf), [ICC profile embedding](https://www.color.org/profile_embedding/), [ExifTool tags](https://exiftool.org/TagNames/).
