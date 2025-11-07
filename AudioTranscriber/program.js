import fs from 'fs';
import mic from 'mic';
import OpenAI from 'openai';
import 'dotenv/config'; // loads variables from .env
import { env } from 'process';


// const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const micInstance = mic({
  rate: '16000',
  channels: '1',
  device: 'default',
});
const micInputStream = micInstance.getAudioStream();

let clipCount = 0;
let writeStream;

micInputStream.on('data', data => {
  if (!writeStream) return;
  writeStream.write(data);
});

async function recordClip() {
  clipCount++;
  const filePath = `clip_${clipCount}.wav`;
  writeStream = fs.createWriteStream(filePath);

  console.log(`🎙️ Recording ${filePath}...`);
  micInstance.start();

  await new Promise(res => setTimeout(res, 5000)); // 5 sec

  micInstance.stop();
  writeStream.end();
  console.log(`✅ Saved ${filePath}`);

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
  });

  console.log('🗣️ Transcribed text:', transcription.text);
}

recordClip();
