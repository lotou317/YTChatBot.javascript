import fs from "fs";
import { spawn } from "child_process";
import path from "path";

// Set up paths for the Whisper executable and model
const whisperPath = path.resolve("../whisper.cpp/build/bin/Release/whisper-cli.exe"); // adjust if needed
const modelPath = path.resolve("./models/ggml-medium.en.bin");

// Clip output path
const filePath = path.resolve("./clip_1.wav");

// Step 1: Record audio using ffmpeg
async function recordClip() {
  console.log(`🎙️ Recording ${filePath}...`);

  // Delete existing file if it already exists
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const ffmpeg = spawn("ffmpeg", [
    "-f", "dshow",
    "-i", "audio=Microphone (Samson C01U Pro Mic)",
    "-t", "5",
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

// Step 2: Run Whisper locally to transcribe
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

  whisper.on("close", () => {
    console.log("\n📜 Raw output:\n", output);
    const match = output.match(/text: "(.*)"/);
    console.log(match ? `🗣️ Transcribed text: ${match[1]}` : "❓ Could not extract text.");
  });
}

// Step 3: Run both
await recordClip();
await transcribe();
