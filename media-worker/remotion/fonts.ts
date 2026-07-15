import { loadFont } from "@remotion/fonts";
import { ARCHIVO_BLACK, POPPINS_BOLD, POPPINS_SEMIBOLD, POPPINS_MEDIUM } from "./fonts-data";

// Fonts are embedded as base64 data URIs (see fonts-data.ts) — loadFont resolves them
// instantly with no network fetch, so a render tab can never hang waiting on a font.
export const DISPLAY = "Archivo Black";
export const BODY = "Poppins";

// `format` must be explicit for data-URI fonts (no extension to infer from).
export const fontsReady: Promise<unknown> = Promise.all([
  loadFont({ family: DISPLAY, url: ARCHIVO_BLACK, weight: "400", format: "truetype" }),
  loadFont({ family: BODY, url: POPPINS_BOLD, weight: "700", format: "truetype" }),
  loadFont({ family: BODY, url: POPPINS_SEMIBOLD, weight: "600", format: "truetype" }),
  loadFont({ family: BODY, url: POPPINS_MEDIUM, weight: "500", format: "truetype" }),
]);
