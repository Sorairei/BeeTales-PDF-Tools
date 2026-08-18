import { mkdir, writeFile } from "node:fs/promises";

const FONT_DIR = "vendor/fonts";
await mkdir(FONT_DIR, { recursive: true });

const STATIC_FONTS = [
  // Carlito (Calibri equivalent)
  { file: "carlito-400-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Regular.ttf" },
  { file: "carlito-700-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Bold.ttf" },
  { file: "carlito-400-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Italic.ttf" },
  { file: "carlito-700-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-BoldItalic.ttf" },

  // Arimo (Arial equivalent)
  { file: "arimo-400-normal.ttf", url: "https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-Regular.ttf" },
  { file: "arimo-700-normal.ttf", url: "https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-Bold.ttf" },
  { file: "arimo-400-italic.ttf", url: "https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-Italic.ttf" },
  { file: "arimo-700-italic.ttf", url: "https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-BoldItalic.ttf" },

  // Tinos (Times New Roman equivalent)
  { file: "tinos-400-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Regular.ttf" },
  { file: "tinos-700-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Bold.ttf" },
  { file: "tinos-400-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Italic.ttf" },
  { file: "tinos-700-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-BoldItalic.ttf" },

  // Cousine (Courier New equivalent)
  { file: "cousine-400-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/cousine/Cousine-Regular.ttf" },
  { file: "cousine-700-normal.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/cousine/Cousine-Bold.ttf" },
  { file: "cousine-400-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/cousine/Cousine-Italic.ttf" },
  { file: "cousine-700-italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/cousine/Cousine-BoldItalic.ttf" },
];

console.log("Downloading static TrueType fonts from official repositories...");

for (const font of STATIC_FONTS) {
  console.log(`Fetching ${font.file}...`);
  const res = await fetch(font.url);
  if (!res.ok) throw new Error(`Failed to download ${font.url}: status ${res.status}`);
  const buf = await res.arrayBuffer();
  await writeFile(`${FONT_DIR}/${font.file}`, Buffer.from(buf));
}

console.log("All 16 static TTF fonts downloaded successfully.");
