import "server-only";
import { openaiChat, type OAMessage, type OAContentPart } from "../agent/complete";
import { MODELS_BY_ID } from "../agent/models";

// Turn one or more images (data URLs — a still or sampled video keyframes) into a
// short factual description a copywriter can work from. ONE call total: the
// description is then reused as text context across all four platform captions,
// so vision is paid for once, not per platform.
//
// Owner's pick is the free groq-vision (Llama 4 Scout); glm-vision is a free
// fallback. Marketing imagery is not customer PII, so a free endpoint is fine.
export async function visionDescribe(images: string[], hint: string): Promise<string> {
  if (!images.length) return "";

  const system =
    "You are a visual analyst helping a social media copywriter. Describe ONLY what is actually shown in the image(s): the main subject, the setting, the mood, any text visible in the image, and the dominant colors. If several frames are given, they are stills from one short video — describe the overall clip. Be concrete and factual in 2–4 sentences. Never invent details, brands, numbers, or text that is not visible.";

  const content: OAContentPart[] = [
    { type: "text", text: hint || "Describe this for a social caption." },
    ...images.map((url): OAContentPart => ({ type: "image_url", image_url: { url } })),
  ];
  const messages: OAMessage[] = [
    { role: "system", content: system },
    { role: "user", content },
  ];

  for (const id of ["groq-vision", "glm-vision"]) {
    const model = MODELS_BY_ID[id];
    if (!model) continue;
    try {
      const r = await openaiChat(model, { messages, maxTokens: 320, temperature: 0.3 });
      const text = (r.message.content ?? "").trim();
      if (text) return text;
    } catch {
      // try the next free vision model
    }
  }
  return "";
}
