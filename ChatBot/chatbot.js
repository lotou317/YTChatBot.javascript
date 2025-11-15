import { spawn } from "child_process";
import { startContinuousRecording } from "../AudioTranscriber/program.js";
import { getAuthorizedClient } from "../YoutubeAuth/auth.js";
import { google } from "googleapis";
import "dotenv/config";
import fs from "fs";

const STREAMER_ACTIVITY = process.env.STREAMER_ACTIVITY;
const STREAMER_CHANNEL_ID = process.env.STREAMER_CHANNEL_ID;
const STREAM_VIDEO_ID = process.env.STREAM_VIDEO_ID;
const RESPONSE_INTERVAL = 120000; // 2 minutes between chat replies
let conversationMemory = []; // holds recent lines of text
const MAX_MEMORY_LENGTH = 10; // only keep the last 10 clips (you can adjust)
const longTermMemoryFile = "./ChatBot/stream_memory.txt";


// -------------------- YouTube Chat Helpers --------------------

async function getLiveChatId(auth, channelId, videoId) {
  const youtube = google.youtube({ version: "v3", auth });

  if (videoId) {
    const videoRes = await youtube.videos.list({
      part: "liveStreamingDetails,snippet",
      id: videoId,
    });
    const video = videoRes.data.items?.[0];
    if (!video) throw new Error("❌ Could not find video with the given ID!");
    const liveChatId = video.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) throw new Error("❌ Stream found, but no active chat!");
    console.log(`✅ Connected to stream: ${video.snippet.title}`);
    return liveChatId;
  } else {
    const searchRes = await youtube.search.list({
      part: "snippet",
      channelId,
      eventType: "live",
      type: "video",
      maxResults: 1,
    });
    const liveVideo = searchRes.data.items?.[0];
    if (!liveVideo) throw new Error("❌ No active live stream found!");
    const videoRes = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: liveVideo.id.videoId,
    });
    return videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  }
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
  console.log(`✅ Sent message: "${message}"`);
}

// -------------------- Short Term Memory Helper --------------------

function updateMemory(transcript) {
  if (!transcript) return;

  conversationMemory.push(transcript);
  if (conversationMemory.length > MAX_MEMORY_LENGTH) {
    conversationMemory.shift(); // remove oldest
  }
}

// -------------------- Long Term Memory Helper --------------------

function saveLongTermMemory(transcript) {
  if (!transcript) return;
  fs.appendFileSync(longTermMemoryFile, transcript + "\n");
}


// -------------------- AI Response Helper --------------------

async function generateAIResponse(transcribedText) {
    const recentMemory = conversationMemory.join("\n");

  const contextPrompt = `
You are a viewer under the username TheNoodlesFanClubPresident chatting in a live YouTube stream.

The streamer called Noodles is playing ${STREAMER_ACTIVITY || "a game"}.
You respond casually, like a real viewer.

Here is what the streamer JUST said:
"${transcribedText}"

Here is the recent conversation context (your short-term memory):
${recentMemory}

Long-term memory (earlier in the stream):
${longTermMemory}

Using both the new message and the memory, write a natural chat message.
Keep it short (1–3 sentences) and casual:
`;

  return new Promise((resolve, reject) => {
    const ollama = spawn("ollama", ["run", "llama3.1:8b"]);
    let output = "";
    let errorOutput = "";

    ollama.stdout.on("data", (data) => (output += data.toString()));
    ollama.stderr.on("data", (data) => (errorOutput += data.toString()));

    ollama.stdin.write(contextPrompt + "\n");
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
    const liveChatId = await getLiveChatId(auth, STREAMER_CHANNEL_ID, STREAM_VIDEO_ID);
    console.log(`🟢 Connected to live chat: ${liveChatId}`);

    // Throttle control
    let lastResponseTime = 0;

    // Start continuous recording + transcription
    startContinuousRecording(async (transcript) => {
      const now = Date.now();

      // Only reply every 2 minutes, but still listen continuously
      if (now - lastResponseTime < RESPONSE_INTERVAL) {
        console.log("⏳ Skipping reply (cooldown active)...");
        return;
      }

      lastResponseTime = now;
      console.log("📜 Received transcript:", transcript);
      updateMemory(transcript);
      saveLongTermMemory(transcript);
      try {
        const aiResponse = await generateAIResponse(transcript);
        const cleaned = aiResponse.replace(/^"|"$/g, "");
        await sendMessage(auth, liveChatId, cleaned);
      } catch (err) {
        console.error("❌ Error generating or sending message:", err);
      }
    });
  } catch (err) {
    console.error("❌ Fatal error in chatbot:", err);
  }
})();
