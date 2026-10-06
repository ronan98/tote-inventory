# Third-party components

The application source, third-party packages, fonts, and optional AI model are
separate works. An application license does not replace the licenses or copyright
notices of the third-party components below.

This inventory was checked against `package.json`, `package-lock.json`, installed
package metadata, and the bundled assets on 2026-10-06. It records dependencies;
it is not a claim that every component is owned by the application author or a
complete notice bundle for a redistributed container image.

## Assets included in this repository

| Files | Attribution | License |
| --- | --- | --- |
| `public/fonts/NotoSans-Regular.ttf`, `public/fonts/NotoSans-Bold.ttf` | Copyright 2018 The Noto Project Authors | SIL Open Font License 1.1 |

The full font copyright notice and license are included in
[`public/fonts/OFL.txt`](public/fonts/OFL.txt). Keep that file with the fonts.
Upstream project: [Noto fonts](https://github.com/notofonts/noto-fonts).

## Direct application dependencies

These are installed from npm during a local build; `node_modules` is excluded
from the source repository. Versions are locked in `package-lock.json`.

| Package | Version checked | Declared license | Upstream |
| --- | --- | --- | --- |
| `@pdf-lib/fontkit` | 1.1.1 | MIT | [Hopding/fontkit](https://github.com/Hopding/fontkit) |
| `@radix-ui/react-dialog` | 1.1.23 | MIT | [radix-ui/primitives](https://github.com/radix-ui/primitives) |
| `archiver` | 8.0.0 | MIT | [archiverjs/node-archiver](https://github.com/archiverjs/node-archiver) |
| `better-sqlite3` | 13.0.3 | MIT | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| `clsx` | 2.1.1 | MIT | [lukeed/clsx](https://github.com/lukeed/clsx) |
| `drizzle-orm` | 0.45.3 | Apache-2.0 | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| `heic-decode` | 2.1.0 | ISC | [catdad-experiments/heic-decode](https://github.com/catdad-experiments/heic-decode) |
| `lucide-react` | 1.52.0 | ISC; some icons derive from MIT-licensed Feather | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| `next` | 16.3.8 | MIT | [vercel/next.js](https://github.com/vercel/next.js) |
| `pdf-lib` | 1.17.1 | MIT | [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) |
| `qrcode` | 1.5.4 | MIT | [soldair/node-qrcode](https://github.com/soldair/node-qrcode) |
| `react`, `react-dom` | 19.3.0 | MIT | [facebook/react](https://github.com/facebook/react) |
| `sharp` | 0.35.5 | Apache-2.0; bundled native libraries have additional licenses | [lovell/sharp](https://github.com/lovell/sharp) |
| `tailwind-merge` | 3.7.0 | MIT | [dcastil/tailwind-merge](https://github.com/dcastil/tailwind-merge) |
| `zod` | 4.6.5 | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) |

Lucide's [full license notice](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
includes both the Lucide ISC notice and the Feather MIT notice. Retain both when
redistributing icons or builds containing them.

Direct build and type dependencies declare MIT, except TypeScript 7.0.2, which
declares Apache-2.0. Their exact versions and dependency trees are in the lockfile.

## Dependencies with additional license conditions

The lockfile contains platform-specific optional packages. Only the packages
appropriate to the installation platform are normally installed.

| Component | License recorded | Role / source |
| --- | --- | --- |
| `libheif-js` 1.23.5 | LGPL-3.0 | HEIC decoding through `heic-decode`; [source and build instructions](https://github.com/catdad-experiments/libheif-js), [underlying libheif source](https://github.com/strukturag/libheif) |
| `@img/sharp-libvips-*` 1.3.4 | LGPL-3.0-or-later | Native image libraries used by sharp; [source/build scripts and notices](https://github.com/lovell/sharp-libvips) |
| `@img/sharp-win32-*` 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Windows sharp binaries and their native libraries |
| `@img/sharp-wasm32` 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | Optional WebAssembly sharp distribution |
| `lightningcss` and platform binaries 1.32.0 | MPL-2.0 | Build-time CSS processing; [source](https://github.com/parcel-bundler/lightningcss) |
| `caniuse-lite` 1.0.30001814 | CC-BY-4.0 | Build-time browser compatibility data; [source](https://github.com/browserslist/caniuse-lite), [original data](https://github.com/Fyrd/caniuse) |
| `pako` 1.0.11 | MIT AND Zlib | Compression dependency; [source and notices](https://github.com/nodeca/pako) |

Sharp's native dependencies include libraries with their own notices and licenses;
the npm package-level license identifier is not an exhaustive list. Consult the
installed package's README/license files and the
[sharp-libvips third-party notices](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md)
for the selected platform and version.

For source-only releases, retain the bundled font notice and dependency lockfile.
For releases that include installed packages, compiled JavaScript, or container
images, retain the corresponding copyright/license notices and meet the relevant
source-availability and replacement/relinking requirements, including those of
LGPL components. Check the exact artifact before distributing it; this summary
does not itself fulfill all binary redistribution obligations. The Debian/Node
base image also contains separately licensed operating-system components.

## Optional local AI

The AI runtime and weights are downloaded separately, not included in this source
repository. [Ollama](https://github.com/ollama/ollama) is MIT-licensed. The default
model derives from [Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct),
whose model card declares Apache-2.0. A different `AI_MODEL` can have different
terms; inspect that model's license before redistributing its weights.

## Application provenance

The app was developed with AI assistance. A review of the application source and
bundled assets found no source-code headers identifying copied application code
from another inventory project. This is a limited repository review, not an
exhaustive comparison against other code or a guarantee of uniqueness. The
third-party components identified above remain their authors' works.
