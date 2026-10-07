import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const rootDir = typeof __dirname !== "undefined"
  ? __dirname
  : (typeof process !== "undefined" ? process.cwd() : ".");

function getAiClient(req: express.Request) {
  const customKey = req.headers["x-gemini-apikey"] as string;
  const apiKey = (customKey && customKey.trim().length > 0) ? customKey.trim() : process.env.GEMINI_API_KEY;
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const VOICE_MAP: Record<string, { voiceName: string; label: string; gender: string; age: string }> = {
  oliver: { voiceName: "Puck", label: "Oliver (Teen Boy)", gender: "male", age: "teen" },
  mia: { voiceName: "Kore", label: "Mia (Teen Girl)", gender: "female", age: "teen" },
  arthur: { voiceName: "Fenrir", label: "Arthur (Adult Male)", gender: "male", age: "adult" },
  victoria: { voiceName: "Zephyr", label: "Victoria (Adult Female)", gender: "female", age: "adult" },
};

async function callTTSWithFallback(aiClient: GoogleGenAI, primaryModel: string, fallbackModel: string, ttsConfig: any) {
  try {
    return await aiClient.models.generateContent({
      model: primaryModel,
      ...ttsConfig,
    });
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
      console.log(`${primaryModel} hit quota limit (429), falling back to ${fallbackModel}...`);
      return await aiClient.models.generateContent({
        model: fallbackModel,
        ...ttsConfig,
      });
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, app: "BritSpeech Studio" });
  });

  app.post("/api/validate-key", async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
        return res.status(400).json({ success: false, error: "API key is required" });
      }

      const testAi = new GoogleGenAI({ apiKey: apiKey.trim() });
      const apiCall = testAi.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: "Hi",
        config: {
          maxOutputTokens: 1,
          temperature: 0,
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 15000)
      );

      await Promise.race([apiCall, timeoutPromise]);
      res.json({ success: true });
    } catch (err: any) {
      const msg = String(err?.message || "");
      console.error("Error validating API key:", err);

      let status = err?.status || err?.statusCode || 0;
      if (msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
        status = 401;
      } else if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        status = 429;
      } else if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
        status = 503;
      } else if (msg.includes("Timeout") || msg.includes("timeout")) {
        status = 408;
      } else if (msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("Network")) {
        status = 502;
      }

      // 4. Never treat HTTP 503 as an invalid API key.
      if (status === 503 || msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
        return res.json({ 
          success: true, 
          warning: "Gemini is temporarily unavailable or experiencing high demand. Your API key may still be valid. Please try again." 
        });
      }

      let errorMessage = "Invalid or unauthorized Gemini API key.";
      if (status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        errorMessage = "This API key has reached its quota or rate limit.";
      } else if (status === 401 || status === 403 || msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
        errorMessage = "Invalid or unauthorized Gemini API key.";
      } else if (status === 408 || msg.includes("Timeout") || msg.includes("timeout")) {
        errorMessage = "Gemini validation timed out. Please try again.";
      } else if (status === 502 || msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("Network")) {
        errorMessage = "Unable to connect to Gemini. Please check your internet connection.";
      } else {
        errorMessage = msg || "Invalid or unauthorized Gemini API key.";
      }

      res.status(400).json({ success: false, error: errorMessage });
    }
  });

  // API Endpoint: Generate Reading Article & TTS Audio
  app.post("/api/generate-reading", async (req, res) => {
    try {
      const aiClient = getAiClient(req);
      let { topic, level, customText, voiceKey } = req.body;
      const voiceInfo = VOICE_MAP[voiceKey] || VOICE_MAP["arthur"];

      let articleText = customText ? customText.trim() : "";
      let articleTitle = topic || "Reading Passage";

      if (!articleText) {
        const prompt = `Write an engaging reading article in British English about "${topic || 'British Culture and Modern Life'}" at CEFR level ${level || 'B1-B2'}. Provide the response in JSON format with two fields: "title" (string) and "text" (string of 200-350 words).`;
        
        const textRes = await aiClient.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        try {
          const parsed = JSON.parse(textRes.text || "{}");
          articleTitle = parsed.title || articleTitle;
          articleText = parsed.text || "London is a vibrant capital city...";
        } catch (e) {
          articleText = textRes.text || "London is a vibrant capital city combining centuries of history with cutting-edge modernity.";
        }
      } else {
        articleTitle = topic ? `Reading: ${topic}` : "Custom Text Reading";
      }

      const ttsRequestPayload = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: articleText,
                speechMetadata: {
                  style: `British English accent, ${voiceInfo.age} ${voiceInfo.gender}, clear, natural reading voice`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceInfo.voiceName },
            },
          },
        },
      };

      const ttsRes = await callTTSWithFallback(
        aiClient,
        "gemini-3.8-flash-lite-tts",
        "gemini-3.8-flash-tts",
        ttsRequestPayload
      );

      let audioBase64: string | undefined = undefined;
      let finishReason = "UNKNOWN";
      if (ttsRes.candidates && ttsRes.candidates.length > 0) {
        finishReason = ttsRes.candidates[0].finishReason || "UNKNOWN";
        for (const candidate of ttsRes.candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData?.data) {
                audioBase64 = part.inlineData.data;
                break;
              }
            }
          }
          if (audioBase64) break;
        }
      }

      if (!audioBase64) {
        throw new Error(`Failed to generate audio from TTS model. finishReason: ${finishReason}`);
      }

      res.json({
        success: true,
        title: articleTitle,
        text: articleText,
        audioBase64,
        voice: voiceInfo.label,
        type: "reading",
      });
    } catch (error: any) {
      console.error("Error in /api/generate-reading:", error);
      const msg = error?.message || "";
      const isAuth = msg.includes("401") || msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("key not valid") || msg.includes("API key");
      const isQuota = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      
      const status = isAuth ? 401 : (isQuota ? 429 : 500);
      res.status(status).json({
        success: false,
        authError: isAuth,
        quotaExceeded: isQuota,
        error: isAuth
          ? "Invalid or unauthorized Gemini API key (401/403)."
          : (isQuota
            ? "Gemini API free tier quota (10 requests per day) exceeded. You can use the instant Browser British Speech Synthesis fallback below!"
            : (msg || "Failed to generate reading audio."))
      });
    }
  });

  // API Endpoint: Generate Dialogue Script & 2-Speaker TTS Audio (Gemini multiSpeakerVoiceConfig requires exactly 2 speakers)
  app.post("/api/generate-dialogue", async (req, res) => {
    try {
      const aiClient = getAiClient(req);
      let { topic, speaker1Key, speaker2Key, level, customScript } = req.body;
      const s1 = VOICE_MAP[speaker1Key] || VOICE_MAP["arthur"];
      const s2 = VOICE_MAP[speaker2Key] || VOICE_MAP["victoria"];

      let dialogueTurns: { speaker: string; text: string }[] = [];
      let dialogueTitle = topic || "Conversational Dialogue";

      const speaker1Name = s1.label.split(' ')[0];
      const speaker2Name = s2.label.split(' ')[0];

      if (customScript && Array.isArray(customScript) && customScript.length > 0) {
        const uniqueSpeakers: string[] = [];
        for (const turn of customScript) {
          if (turn.speaker && !uniqueSpeakers.includes(turn.speaker)) {
            uniqueSpeakers.push(turn.speaker);
          }
        }
        const availableSpeakers = [speaker1Name, speaker2Name];
        const speakerMapping: Record<string, string> = {};
        uniqueSpeakers.forEach((spk, idx) => {
          speakerMapping[spk] = availableSpeakers[idx % availableSpeakers.length];
        });

        dialogueTurns = customScript.map(turn => ({
          speaker: speakerMapping[turn.speaker] || speaker1Name,
          text: turn.text
        }));
      } else {
        const prompt = `Write a natural 2-speaker conversation script in British English between "${speaker1Name}" and "${speaker2Name}" about "${topic || 'Ordering Afternoon Tea in London'}" at CEFR level ${level || 'B1-B2'}.
Include natural conversational nuances like |yeah|, |mhm|, and short pauses if appropriate.
Return a JSON array of objects with keys "speaker" (one of the 2 names) and "text" (spoken lines). Total 6 to 10 turns.`;

        const scriptRes = await aiClient.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        try {
          const parsed = JSON.parse(scriptRes.text || "[]");
          if (Array.isArray(parsed)) {
            dialogueTurns = parsed;
          } else if (parsed.turns) {
            dialogueTurns = parsed.turns;
            dialogueTitle = parsed.title || dialogueTitle;
          }
        } catch (e) {
          dialogueTurns = [
            { speaker: speaker1Name, text: "Hello! Lovely afternoon for a walk in Hyde Park, isn't it?" },
            { speaker: speaker2Name, text: "Oh, absolutely |yeah|, the weather is surprisingly sunny today!" },
          ];
        }
      }

      const dialogueParts = dialogueTurns.map((turn) => {
        const tLower = turn.speaker.toLowerCase();
        let speakerName = speaker1Name;
        if (tLower.includes(speaker2Name.toLowerCase())) speakerName = speaker2Name;

        return {
          text: `${speakerName}: ${turn.text}`,
          speechMetadata: {
            speaker: speakerName,
            style: "British English accent, conversational, expressive",
          },
        };
      });

      const dialogueTtsRequestPayload = {
        contents: [
          {
            role: "user",
            parts: dialogueParts,
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: speaker1Name,
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: s1.voiceName },
                  },
                },
                {
                  speaker: speaker2Name,
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: s2.voiceName },
                  },
                },
              ],
            },
          },
        },
      };

      const ttsRes = await callTTSWithFallback(
        aiClient,
        "gemini-3.8-flash-tts",
        "gemini-3.8-flash-lite-tts",
        dialogueTtsRequestPayload
      );

      let audioBase64: string | undefined = undefined;
      if (ttsRes.candidates) {
        for (const candidate of ttsRes.candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData?.data) {
                audioBase64 = part.inlineData.data;
                break;
              }
            }
          }
          if (audioBase64) break;
        }
      }

      if (!audioBase64) {
        throw new Error("Failed to generate multi-speaker audio from TTS model.");
      }

      res.json({
        success: true,
        title: dialogueTitle,
        dialogueTurns,
        audioBase64,
        speaker1: s1.label,
        speaker2: s2.label,
        type: "dialogue",
      });
    } catch (error: any) {
      console.error("Error in /api/generate-dialogue:", error);
      const msg = error?.message || "";
      const isAuth = msg.includes("401") || msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("key not valid") || msg.includes("API key");
      const isQuota = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      
      const status = isAuth ? 401 : (isQuota ? 429 : 500);
      res.status(status).json({
        success: false,
        authError: isAuth,
        quotaExceeded: isQuota,
        error: isAuth
          ? "Invalid or unauthorized Gemini API key (401/403)."
          : (isQuota
            ? "Gemini API free tier quota (10 requests per day) exceeded. You can use browser speech synthesis fallback."
            : (msg || "Failed to generate dialogue audio."))
      });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = fs.existsSync(path.resolve(rootDir, "dist"))
      ? path.resolve(rootDir, "dist")
      : path.resolve(rootDir, "../dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
