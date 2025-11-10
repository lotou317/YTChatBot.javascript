import fs from "fs";
import { spawn } from "child_process";
import { recordClip, transcribe } from "../AudioTranscriber/program.js";
import { getAuthorizedClient } from "../YoutubeAuth/auth.js";
import { google } from "googleapis";
import "dotenv/config";

const STREAMER_CHANNEL_ID = process.env.STREAMER_CHANNEL_ID;
const STREAM_VIDEO_ID = process.env.STREAM_VIDEO_ID; // optional, put in .env if you know it
const LOOP_INTERVAL = 120000; // 2 minutes in ms

// -------------------- YouTube Chat Helpers --------------------

async function getLiveChatId(auth, channelId, videoId) {
  const youtube = google.youtube({ version: "v3", auth });

  let liveChatId;
  let videoTitle;

  if (videoId) {
    const videoRes = await youtube.videos.list({
      part: "liveStreamingDetails,snippet",
      id: videoId,
    });

    const video = videoRes.data.items?.[0];
    if (!video) throw new Error("❌ Could not find video with the given ID!");

    liveChatId = video.liveStreamingDetails?.activeLiveChatId;
    videoTitle = video.snippet.title;
  } else {
    const searchRes = await youtube.search.list({
      part: "snippet",
      channelId,
      eventType: "live",
      type: "video",
      maxResults: 1,
    });

    const liveVideo = searchRes.data.items?.[0];
    if (!liveVideo) return null; // no live stream
    const videoRes = await youtube.videos.list({
      part: "liveStreamingDetails,snippet",
      id: liveVideo.id.videoId,
    });
    liveChatId = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    videoTitle = videoRes.data.items?.[0]?.snippet.title;
  }

  return liveChatId ? { liveChatId, videoTitle } : null;
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

// -------------------- AI Response Helper --------------------

async function generateAIResponse(transcribedText) {
  const contextPrompt = `
You are a viewer in a live YouTube chat.
The streamer is currently talking and you want to send a message in response.
Keep your reply short (1–3 sentences), casual, and sound like a real YouTube chatter.
Sometimes react with emojis or slang depending on what was said.
Avoid repeating what the streamer said.
Here's what the streamer just said: "${transcribedText}"
Write your chat message:
`;

  return new Promise((resolve, reject) => {
    const ollama = spawn("ollama", ["run", "llama3.1:8b"]);
    let output = "";
    let errorOutput = "";

    ollama.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      output += text;
    });

    ollama.stderr.on("data", (data) => errorOutput += data.toString());

    ollama.stdin.write(contextPrompt + "\n");
    ollama.stdin.end();

    ollama.on("close", (code) => {
      if (code !== 0) {
        console.error("❌ Ollama failed:", errorOutput);
        reject(errorOutput);
      } else {
        resolve(output.trim());
      }
    });
  });
}

// -------------------- Main Loop --------------------

(async () => {
  try {
    const auth = await getAuthorizedClient();

    while (true) {
      const liveChatData = await getLiveChatId(auth, STREAMER_CHANNEL_ID, STREAM_VIDEO_ID);

      if (!liveChatData) {
        console.log("⚠️ No live stream currently active. Retrying in 2 minutes...");
        await new Promise(r => setTimeout(r, LOOP_INTERVAL));
        continue;
      }

      const { liveChatId, videoTitle } = liveChatData;
      console.log(`🟢 Connected to live chat: ${liveChatId} (${videoTitle})`);

      try {
        await recordClip();
        const transcript = await transcribe();

        if (!transcript || transcript.length === 0) {
          console.log("❌ No transcript to generate AI response.");
        } else {
          const aiResponse = await generateAIResponse(transcript);
          const cleanedResponse = aiResponse.replace(/^"|"$/g, "");
          console.log(`🤖 AI Response: ${cleanedResponse}`);
          await sendMessage(auth, liveChatId, cleanedResponse);
        }
      } catch (err) {
        console.error("❌ Error processing clip:", err);
      }

      console.log(`⏱ Waiting ${LOOP_INTERVAL / 1000} seconds before next iteration...`);
      await new Promise(r => setTimeout(r, LOOP_INTERVAL));
    }

  } catch (err) {
    console.error("❌ Fatal error in chatbot:", err);
  }
})();
