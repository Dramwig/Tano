# Tano brand assets

The icon shows two overlapping gradient pages on a white rounded square. It has no outer glow; the overlap keeps a soft sense of depth.

- `../public/favicon.svg` is the blue vector variant.
- `1024x1024.png` is the blue SVG exported at 1024 pixels.
- `../public/favicon-green.svg` is the green variant used by the current interface, browser icon, and native app icon. It changes the colors while keeping the same paths, dimensions, gradients, shadows, and transparency.
- `green/1024x1024.png` is the green SVG exported at 1024 pixels.

After editing an SVG, run `npm run icons -w @tano/client` from the repository root. It regenerates Windows, macOS, iOS, and Android icons from the green source, exports both 1024-pixel PNGs, and updates the two Android resource directories.
