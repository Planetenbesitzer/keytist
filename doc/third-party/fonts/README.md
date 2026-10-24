# Font license source notes

These files accompany the font inventory in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Original font files were read without alteration. No font binary was downloaded or regenerated while collecting these notices.

- `embedded-name-metadata.json` preserves the exact unique strings from the existing fonts' OpenType name records (including copyright and license records) and SHA-256 of every original font binary.
- License text files and the MiSans PDF were obtained from publisher-controlled repositories or official sites. `sources.json` records their URLs and SHA-256 checksums as retrieved on 2026-10-16.
- `ARPHICPL.TXT` was extracted verbatim from the license record of `WenDingPLKaiTi.woff2`; the Song font contains the same license text. The file is not rewritten as a new license.
- JetBrains Mono 1.0.3 and Open Sans 1.10 expressly identify Apache-2.0 in the bundled font metadata. A later upstream release's OFL license is not substituted for that evidence.
- The source inventory includes Alibaba PuHuiTi and MiSans, but those two fonts are omitted from the share package. Their source notes and official reference terms remain to document that choice.

## Replacing the IPA-derived fonts with the original fonts

The bundled **LXGW Neo XiHei** and **LXGW Neo ZhiSong** are derivatives under IPA Font License Agreement v1.0. The complete license files are included beside this document. Their upstream project sources and development files are available at:

- [LXGW Neo XiHei](https://github.com/lxgw/LxgwNeoXiHei) and its [`projects` source directory](https://github.com/lxgw/LxgwNeoXiHei/tree/main/projects).
- [LXGW Neo ZhiSong](https://github.com/lxgw/LxgwNeoZhiSong) and its [source repository](https://github.com/lxgw/LxgwNeoZhiSong).

The following method allows recipients of this editable source package to replace these derivatives with the original IPA fonts. This method is provided for the replacement option required by the IPA license; no original IPA font is silently downloaded or installed.

1. Obtain **IPAex Gothic (`ipaexg.ttf`)** for Neo XiHei and **IPAex Mincho (`ipaexm.ttf`)** for Neo ZhiSong from the official [IPA font download page](https://moji.or.jp/ipafont/ipafontdownload/). Neo ZhiSong also derives from IPAmj Mincho; that original is available from the official [IPAmj Mincho download page](https://moji.or.jp/mojikiban/font/).
2. Keep the original font filenames, internal font names, notices and license supplied by the publisher. Copy the chosen original TTF files into this project's editable `src/assets/fonts/` directory.
3. In `src/assets/styles/font.scss`, remove `LXGWNeoXiHei` and/or `LXGWNeoZhiSong` from the `$fonts` WOFF2 list. Add `@font-face` rules for the actual originals, for example:

   ```scss
   @font-face {
     font-family: 'IPAexGothic';
     font-display: swap;
     src: url('../fonts/ipaexg.ttf') format('truetype');
   }
   @font-face {
     font-family: 'IPAexMincho';
     font-display: swap;
     src: url('../fonts/ipaexm.ttf') format('truetype');
   }
   ```

4. In `src/configs/font.ts`, replace the corresponding Neo XiHei / Neo ZhiSong option's displayed name and font-family value with `IPAexGothic` / `IPAexMincho`. If choosing IPAmj Mincho instead, use its actual filename and font-family in the same manner. These application aliases do not require editing the font's internal names or data.
5. Run `npm ci`, then `npm run build`, and restart the local application. In an existing document, select the original font using the font menu for any text that previously used the derivative. The recipients can remove the no-longer-used derivative files from their own source copy.

The original IPA font has a different glyph set and metrics, so a document may need layout adjustments. For the publisher's own guidance, see the [IPA license and FAQ](https://moji.or.jp/ipafont/license/) and the derivative author's [embedding instructions](https://github.com/lxgw/lxgw/blob/main/documents/xizhi_embedding_instructions.md).
