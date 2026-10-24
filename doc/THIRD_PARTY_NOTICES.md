# Third-party notices

Slide Studio is a locally modified version of [PPTist](https://github.com/pipipi-pikachu/PPTist). The application source is distributed under the GNU Affero General Public License, version 3. The full license is in `../LICENSE`; the upstream author and project notices are retained in `README.upstream.md` and `../README_zh.md`. The third-party components below retain their own licenses.

## Fonts

The inventory below was checked against the actual OpenType `name` tables of the 21 WOFF2 files in the original repository on 2026-10-16. Exact embedded copyright, version, family, designer and license strings, together with each font file's SHA-256, are retained in [embedded-name-metadata.json](third-party/fonts/embedded-name-metadata.json). This records the files present; it is not a certification of the complete acquisition or conversion history of each upstream binary.

The share package contains **19 bundled fonts**. It omits the Alibaba PuHuiTi and MiSans binaries and their font-menu registrations. Their entries below document the original repository inventory and the reason for that packaging choice. The local development installation can retain its existing files. No system font files are distributed.

| Original repository font file | Embedded version / family | License evidence and retained text |
| --- | --- | --- |
| `DeYiHei.woff2` | Smiley Sans Oblique 2.0.1 | Embedded SIL OFL 1.1; [official license](third-party/fonts/DeYiHei-LICENSE.txt) |
| `Inter.woff2` | Inter 3.3 | Embedded SIL OFL 1.1; [v3.3 official license](third-party/fonts/Inter-LICENSE.txt) |
| `JetBrainsMono.woff2` | JetBrains Mono 1.0.3 | **Embedded Apache-2.0**, not the license of the current font release; [v1.0.3 official license](third-party/fonts/JetBrainsMono-v1.0.3-LICENSE.txt) |
| `LXGWNeoXiHei.woff2` | LXGW Neo XiHei 1.302 | Embedded IPA Font License 1.0; [official license](third-party/fonts/LXGWNeoXiHei-LICENSE.md), [original-font replacement instructions](third-party/fonts/README.md#replacing-the-ipa-derived-fonts-with-the-original-fonts) |
| `LXGWNeoZhiSong.woff2` | LXGW Neo ZhiSong 1.064 | Embedded IPA Font License 1.0; [official license](third-party/fonts/LXGWNeoZhiSong-LICENSE.md), [original-font replacement instructions](third-party/fonts/README.md#replacing-the-ipa-derived-fonts-with-the-original-fonts) |
| `LXGWWenKai.woff2` | LXGW WenKai GB Screen 1.311 | Embedded LXGW and Klee copyrights; [official Screen project SIL OFL 1.1](third-party/fonts/LXGWWenKai-Screen-OFL.txt) |
| `Lato.woff2` | Lato 1.104 | Embedded SIL OFL 1.1 and Reserved Font Name “Lato”; [official distribution license](third-party/fonts/Lato-OFL.txt) |
| `Literata.woff2` | Literata Book 2.003 | Embedded SIL OFL 1.1; [official project license](third-party/fonts/Literata-OFL.txt) |
| `Merriweather.woff2` | Merriweather 2.002 | Embedded SIL license URL and Reserved Font Name “Merriweather”; [official project SIL OFL 1.1](third-party/fonts/Merriweather-OFL.txt) |
| `Montserrat.woff2` | Montserrat 4.000 | Embedded SIL OFL 1.1; [official project license](third-party/fonts/Montserrat-OFL.txt) |
| `OpenSans.woff2` | Open Sans 1.10 | **Embedded Apache-2.0**, not the license of the current font release; [Apache License 2.0](third-party/fonts/Apache-2.0.txt) |
| `Roboto.woff2` | Roboto 1.00000, 2011 | Embedded Google 2011 copyright; [historical official Roboto Apache-2.0 license](third-party/fonts/Roboto-LICENSE.txt). The embedded file has no license-name field; the upstream historical license is retained, without claiming a byte-for-byte match to that upstream release. |
| `SourceHanSans.woff2` | Source Han Sans CN VF 2.004 | Embedded SIL OFL 1.1 and Reserved Font Name “Source”; [official license](third-party/fonts/SourceHanSans-LICENSE.txt) |
| `SourceHanSerif.woff2` | Source Han Serif CN VF 2.002 | Embedded SIL OFL 1.1 and Reserved Font Name “Source”; [official license](third-party/fonts/SourceHanSerif-LICENSE.txt) |
| `SourceSansPro.woff2` | Source Sans Pro 2.020 | Embedded SIL OFL 1.1 and Reserved Font Name “Source”; [official 2.020 release license](third-party/fonts/SourceSansPro-LICENSE.md) |
| `SourceSerif4.woff2` | Source Serif 4 4.004 | Embedded SIL OFL 1.1 and Reserved Font Name “Source”; [official 4.004 release license](third-party/fonts/SourceSerif4-LICENSE.md) |
| `WenDingPLKaiTi.woff2` | AR PL KaitiM GB 2.11 | Complete [ARPHIC PUBLIC LICENSE](third-party/fonts/ARPHICPL.TXT), extracted verbatim from the font's embedded license field |
| `WenDingPLSongTi.woff2` | AR PL SungtiL GB 2.11 | Complete [ARPHIC PUBLIC LICENSE](third-party/fonts/ARPHICPL.TXT), also embedded in this font |
| `ZhuQueFangSong.woff2` | Zhuque Fangsong technical preview 0.108 | Embedded SIL OFL 1.1; [official project license](third-party/fonts/ZhuQueFangSong-LICENSE.txt) |
| `AlibabaPuHuiTi.woff2` — **omitted from share package** | Alibaba PuHuiTi 2.0, 55 Regular, 2.00 | Embedded Alibaba/Hanyi copyright, no embedded license field. The official site's current legal link points to a **3.0** statement. Permission for this pre-existing 2.0 WOFF2 conversion and redistribution has not been established here. See [source note](third-party/fonts/AlibabaPuHuiTi-SOURCE-NOTE.md). |
| `MiSans.woff2` — **omitted from share package** | MiSans 4.003 | Embedded Xiaomi/Hanyi copyright, no embedded license field. The [official current MiSans license](third-party/fonts/MiSans-LICENSE.pdf) prohibits adaptation/redevelopment and separate redistribution. The acquisition/conversion history of this upstream WOFF2 has not been established here, so the share package leaves it out. |

For the original installation that retains MiSans: this software uses MiSans fonts. Copyright © 2020–2023 Beijing Xiaomi Mobile Software Co., Ltd. All Rights Reserved. The official MiSans agreement is retained in full; this notice does not grant any additional font rights.

The preferred font menu names **Helvetica Neue, Times New Roman, Apple Chancery and Arial** refer only to locally installed fonts on the recipient's computer. Their proprietary font binaries are not bundled or relicensed by Slide Studio. Availability and appearance depend on that computer's installed fonts. Fonts imported by a document's author are separate document assets and must be used under their own terms.

Where a current upstream license file has a newer copyright range or additional names, the original embedded notices above remain in the metadata inventory. The downloaded license files are preserved as received; they do not change the recorded version of the local font binary. Download URLs, dates and checksums are recorded in [sources.json](third-party/fonts/sources.json).

## JavaScript and other dependencies

The package manifest and lockfile identify the software dependencies. Their own copyright notices and license texts are supplied with the share package under its third-party license directory. These dependencies are not relicensed merely by inclusion with Slide Studio. Preserve the supplied notices when redistributing the package.

Slide Studio is an independent project and is not an Apple Keynote product or endorsed by the font publishers named above.
