import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Get proper __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🧭 Paths (now fully correct relative to AudioTranscriber/)
const whisperPath = path.resolve(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
const modelPath = path.resolve(__dirname, "./models/ggml-medium.en.bin");
const filePath = path.resolve(__dirname, "../ChatBot/clip_1.wav"); // chatbot.js saves clips here

// Step 1: Record audio
async function recordClip() {
  console.log(`🎙️ Recording ${filePath}...`);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const ffmpeg = spawn("ffmpeg", [
    "-f", "dshow",
    "-i", "audio=Microphone (Samson C01U Pro Mic)",
    "-t", "15",
    "-ac", "1",
    "-ar", "16000",
    filePath
  ]);

  return new Promise((resolve, reject) => {
    ffmpeg.stderr.on("data", data => process.stderr.write(data.toString()));
    ffmpeg.on("exit", code => {
      if (code === 0) {
        console.log(`✅ Saved ${filePath}`);
        resolve();
      } else {
        reject(new Error("FFmpeg failed"));
      }
    });
  });
}

// Step 2: Run Whisper to transcribe
async function transcribe() {
  console.log("🧠 Transcribing locally with Whisper...");

  const whisper = spawn(whisperPath, ["-m", modelPath, "-f", filePath]);

  let output = "";
  whisper.stdout.on("data", data => {
    const text = data.toString();
    process.stdout.write(text);
    output += text;
  });

  whisper.stderr.on("data", data => process.stderr.write(`⚠️ ${data}`));

  return new Promise(resolve => {
    whisper.on("close", () => {
      console.log("\n📜 Raw output:\n", output);

      const transcriptLines = output
        .split("\n")
        .filter(line => line.match(/\[\d{2}:\d{2}:\d{2}\.\d{3}/))
        .map(line => line.replace(/\[.*?\]\s*/g, "").trim())
        .filter(line => line.length > 0);

      const transcript = transcriptLines.join(" ").trim();

      if (transcript) {
        console.log(`🗣️ Transcribed text: "${transcript}"`);
      } else {
        console.log("❓ Could not extract text.");
      }

      resolve(transcript);
    });
  });
}

export { recordClip, transcribe };
