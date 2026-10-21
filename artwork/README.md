# YepControl artwork

`icon.svg` and `feature-graphic.svg` are editable vector sources. Their PNG
exports are the 512 × 512 Google Play icon and 1024 × 500 feature graphic.
The phone outline distinguishes YepControl from its sibling while retaining
the owner's green Y/check family mark, adapted from the MIT-licensed
[YepAnywhere artwork](https://github.com/kzahel/yepanywhere/tree/main/packages/android/artwork).
Copyright 2026 Kyle Graehl; project MIT license applies.

Render with librsvg:

```sh
rsvg-convert -o artwork/play-store-icon.png artwork/icon.svg
rsvg-convert -o artwork/feature-graphic.png artwork/feature-graphic.svg
```

The native adaptive launcher icon uses the same phone/Y mark and a solid
family-green background. API 33+ includes a monochrome themed icon.
Store screenshots must be captured from the actual app with synthetic content;
keep raw captures private and copy only reviewed, intentionally public exports
into the distribution folder. Never publish a live pairing code or phone data.
