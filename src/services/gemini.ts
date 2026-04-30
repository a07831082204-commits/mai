import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "" 
});

export type Message = {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  attachments?: string[];
};

export async function* chatStream(messages: Message[]) {
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const streamResponse = await ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: contents,
    config: {
      systemInstruction: "أنت المساعد الذكي الخاص بـ 'muntadher.asd'. أجب دائماً باللغة العربية بأسلوب مهذب واحترافي. قدم إجابات غنية ومنسقة باستخدام Markdown."
    }
  });

  for await (const chunk of streamResponse) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      yield c.text;
    }
  }
}
