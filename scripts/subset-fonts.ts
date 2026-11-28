// 画面で使う文字だけに絞った woff2 を作る。使い方：node scripts/subset-fonts.ts（docs/screens.md の「色・フォント・刷り」）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = join(root, "src");
const output = join(src, "shared", "fonts");
const charsFile = join(output, "chars.txt");
const chars = new Set("、。「」『』！？・…〜（）：／％＋－×　ー");
for (const [first, last] of [
  [0x20, 0x7e],
  [0x3041, 0x3096],
  [0x30a1, 0x30fa],
]) {
  for (let code = first; code <= last; code++) chars.add(String.fromCodePoint(code));
}

function stripCommentsKeepingUrls(source: string): string {
  return source.replace(
    /([a-z][a-z\d+.-]*:\/\/[^\s"'`<>]+)|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\r\n]*/gi,
    "$1",
  );
}

function collectChars(file: string): void {
  const source = stripCommentsKeepingUrls(readFileSync(file, "utf8"));
  for (const char of source) {
    if (char.charCodeAt(0) > 0x7f) chars.add(char);
  }
}

for (const file of readdirSync(src, { recursive: true, withFileTypes: true })) {
  if (file.isFile() && /\.(ts|tsx|css)$/.test(file.name) && !file.name.endsWith(".test.ts")) {
    collectChars(join(file.parentPath, file.name));
  }
}
for (const file of readdirSync(root, { withFileTypes: true })) {
  if (file.isFile() && file.name.endsWith(".html")) collectChars(join(root, file.name));
}
const sortedChars = [...chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
writeFileSync(charsFile, sortedChars.join(""));

const cache = join(tmpdir(), "funyaoji-fonts");
mkdirSync(cache, { recursive: true });
for (const [source, name] of [
  ["zenoldmincho/ZenOldMincho-Black.ttf", "zen-old-mincho-900.woff2"],
  ["zenkakugothicnew/ZenKakuGothicNew-Bold.ttf", "zen-kaku-gothic-new-700.woff2"],
  ["zenkakugothicnew/ZenKakuGothicNew-Black.ttf", "zen-kaku-gothic-new-900.woff2"],
]) {
  const ttf = join(cache, basename(source));
  if (!existsSync(ttf)) {
    const response = await fetch(
      `https://raw.githubusercontent.com/google/fonts/main/ofl/${source}`,
    );
    if (!response.ok) throw new Error(`${source} の取得に失敗しました (HTTP ${response.status})`);
    writeFileSync(ttf, new Uint8Array(await response.arrayBuffer()));
  }
  const file = join(output, name);
  execFileSync(
    "uvx",
    [
      "--from",
      "fonttools[woff]",
      "pyftsubset",
      ttf,
      `--text-file=${charsFile}`,
      "--flavor=woff2",
      "--no-hinting",
      "--layout-features=*",
      `--output-file=${file}`,
    ],
    { stdio: "inherit" },
  );
  console.log(`${name}: ${statSync(file).size} bytes`);
}
