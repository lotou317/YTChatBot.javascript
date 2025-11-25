import { spawn } from "child_process";
import { startContinuousRecording } from "../AudioTranscriber/program.js";
import { getAuthorizedClient } from "../YoutubeAuth/auth.js";
import { google } from "googleapis";
import "dotenv/config";

import MemoryManager from "./memory/MemoryManager.js";
const memory = new MemoryManager(); // now handles all DB actions

const STREAMER_ACTIVITY = process.env.STREAMER_ACTIVITY;
const STREAMER_CHANNEL_ID = process.env.STREAMER_CHANNEL_ID;
const STREAM_VIDEO_ID = process.env.STREAM_VIDEO_ID;

const RESPONSE_INTERVAL = 120000; // 2 minutes cooldown
let isGenerating = false;

// -------------------- YouTube Helpers --------------------

async function getLiveChatId(auth, channelId, videoId) {
  const youtube = google.youtube({ version: "v3", auth });

  const videoRes = await youtube.videos.list({
    part: "liveStreamingDetails,snippet",
    id: videoId,
  });

  const video = videoRes.data.items?.[0];
  if (!video) throw new Error("❌ Could not find video with that ID!");

  const liveChatId = video.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error("❌ Stream found, but no active chat!");

  console.log(`🎬 Connected to stream: ${video.snippet.title}`);
  return liveChatId;
}

async function sendMessage(auth, liveChatId, message) {
  const youtube = google.youtube({ version: "v3", auth });

  await youtube.liveChatMessages.insert({
    part: "snippet",
    requestBody: {
      snippet: {
        liveChatId,
        type: "textMessageEvent",
        textMessageDetails: { messageText: message },
      },
    },
  });

  console.log(`💬 Sent: ${message}`);
}

async function getStreamTitle(auth, videoId) {
  const youtube = google.youtube({ version: "v3", auth });
  const res = await youtube.videos.list({
    part: "snippet",
    id: videoId,
  });
  
  const video = res.data.items?.[0];
  if (!video) throw new Error("❌ Could not find video with that ID!");

  return video.snippet.title; // this is the stream title
}

// -------------------- AI Response --------------------

async function generateAIResponse(transcribedText) {
  const recentMemory = (await memory.getShortTermMemory(STREAM_VIDEO_ID))
    .map(m => m.content)
    .join("\n");

  const longTermSummary = await memory.getLongTermSummary(STREAM_VIDEO_ID);

  const prompt = `
You are TheNoodlesFanClubPresident, a casual YouTube chat viewer.
The streamer Noodles is playing ${STREAMER_ACTIVITY || "a game"}.

Streamer said:
"${transcribedText}"

Recent memory:
${recentMemory}

Long-term memory:
${longTermSummary}

Write a natural, casual 1–3 sentence chat message.
`;

  return new Promise((resolve, reject) => {
    const ollama = spawn("ollama", ["run", "llama3.1:8b"]);
    let output = "";
    let errorOutput = "";

    ollama.stdout.on("data", (d) => (output += d.toString()));
    ollama.stderr.on("data", (d) => (errorOutput += d.toString()));

    ollama.stdin.write(prompt);
    ollama.stdin.end();

    ollama.on("close", (code) => {
      if (code !== 0) reject(errorOutput);
      else resolve(output.trim());
    });
  });
}

// -------------------- Main --------------------

(async () => {
  try {
    const auth = await getAuthorizedClient();
    const title = await getStreamTitle(auth, STREAM_VIDEO_ID);
    const liveChatId = await getLiveChatId(
      auth,
      STREAMER_CHANNEL_ID,
      STREAM_VIDEO_ID
    );

    // ▶ Initialize MemoryManager for this stream
    await memory.startStream(STREAM_VIDEO_ID, title);
    console.log("🧠 Memory initialized for this stream.");

    let lastResponseTime = 0;

    startContinuousRecording(async (transcript) => {
      if (!transcript || transcript.trim().length < 3) return;

      const now = Date.now();

      // Save everything into the DB
      await memory.saveTranscript(STREAM_VIDEO_ID, transcript);
      await memory.updateSummary(STREAM_VIDEO_ID, transcript);

      // Enforce cooldown
      if (now - lastResponseTime < RESPONSE_INTERVAL) {
        console.log("⏳ Cooldown — memory saved, reply skipped.");
        return;
      }

      if (isGenerating) {
        console.log("⚠️ AI is busy, skipping.");
        return;
      }

      isGenerating = true;
      lastResponseTime = now;

      try {
        const reply = await generateAIResponse(transcript);
        const cleaned = reply.replace(/^"|"$/g, "");
        await sendMessage(auth, liveChatId, cleaned);
      } catch (err) {
        console.error("❌ AI/Chat Error:", err);
      } finally {
        isGenerating = false;
      }
    });

  } catch (err) {
    console.error("❌ Fatal chatbot error:", err);
  }
})();
