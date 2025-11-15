import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const whisperPath = path.resolve(__dirname, "../whisper.cpp/build/bin/Release/whisper-cli.exe");
const modelPath = path.resolve(__dirname, "./models/ggml-medium.en.bin");
const clipsDir = path.resolve(__dirname, "../ChatBot/clips");

if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

/**
 * Record continuous short audio clips one after another.
 * Each clip is about 15 seconds (configurable).
 */
async function startContinuousRecording(onTranscript) {
  console.log("🎙️ Starting continuous recording...");

  let clipIndex = 0;
  const segmentDuration = 15; // seconds

  while (true) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(clipsDir, `clip_${clipIndex}_${timestamp}.wav`);

    console.log(`🎧 Recording: ${filePath}`);
    await recordClip(filePath, segmentDuration);

    // As soon as recording ends, start transcription (don’t block next record)
    transcribe(filePath).then(transcript => {
      if (transcript && transcript.trim().length > 0) {
        console.log("🗣️ Transcript:", transcript);
        onTranscript?.(transcript); // Send transcript to chatbot
      }
    });

    clipIndex++;
  }
}

/**
 * Record one short clip with ffmpeg
 */
function recordClip(filePath, durationSec = 15) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f", "dshow",
      "-i", "audio=Microphone (Samson C01U Pro Mic)",
      "-t", durationSec.toString(),
      "-ac", "1",
      "-ar", "16000",
      filePath
    ]);

    ffmpeg.stderr.on("data", data => process.stderr.write(data.toString()));

    ffmpeg.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("FFmpeg recording failed"));
      }
    });
  });
}

/**
 * Transcribe one audio clip with Whisper
 */
function transcribe(filePath) {
  console.log(`🧠 Transcribing: ${path.basename(filePath)}`);

  const whisper = spawn(whisperPath, ["-m", modelPath, "-f", filePath]);
  let output = "";

  whisper.stdout.on("data", data => (output += data.toString()));
  whisper.stderr.on("data", data => process.stderr.write(`⚠️ ${data}`));

  return new Promise(resolve => {
    whisper.on("close", () => {
      const transcriptLines = output
        .split("\n")
        .filter(line => line.match(/\[\d{2}:\d{2}:\d{2}\.\d{3}/))
        .map(line => line.replace(/\[.*?\]\s*/g, "").trim())
        .filter(line => line.length > 0);

      const transcript = transcriptLines.join(" ").trim();
      resolve(transcript);
    });
  });
}

export { startContinuousRecording };