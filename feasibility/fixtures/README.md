# Synthetic HEIC fixtures

The fixtures contain solid colors drawn with Pillow 13.0.0 and encoded at quality 90 with pillow-heif 1.8.1. They contain no photos or private metadata. ImageMagick reports the expected geometry. Tests also create truncated bytes and mixed folder entries at runtime.

| File | Expected result | SHA-256 |
| --- | --- | --- |
| `split-color.heic` | 64 × 32, red left and blue right, NCLX | `db6352eb8f38440d90cb7d3483554efa49acefc30f9bb8e17deac1afef043365` |
| `scaled-preview.heic` | Same split at 1024 × 512, 512 × 256 preview | `f81f53d8fafe1e9a9b2edc27f84198f510cff0293d6f895bf4785e88c78ffcf9` |
| `second-primary.heic` | 32 × 48 blue primary, with a separate 48 × 24 red top-level image | `e9d990d4d2084d5e64e409270027db58f4b8e48bb59af24d9922a7e0f1bcd2de` |

These fixtures cover basic decoding and primary selection. The representative F2 corpus still needs orientation, mirroring, cropping, ICC, 10-bit, HDR, tiled and auxiliary cases.
