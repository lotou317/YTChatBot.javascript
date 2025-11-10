import fs from "fs";
import path from "path";
import readline from "readline";
import { google } from "googleapis";
import { fileURLToPath } from "url";

// -------------------- Helpers for ES modules --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scopes define the level of access your bot has.
const SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"];
const TOKEN_PATH = path.join(__dirname, "token.json");  // now absolute
const CREDENTIALS_PATH = path.join(__dirname, "client_secret.json"); // now absolute

// Load client secrets
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// -------------------- Token Setup --------------------
if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);
  console.log("✅ Token loaded successfully!");
  testYouTubeAPI(oAuth2Client);
} else {
  getNewToken(oAuth2Client);
}

// Function to get a new token
function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("\n👉 Authorize this app by visiting this URL:\n", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("\nPaste the code from that page here: ", async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
      console.log("✅ Token saved to", TOKEN_PATH);
      testYouTubeAPI(oAuth2Client);
    } catch (err) {
      console.error("❌ Error retrieving access token", err);
    }
  });
}

// -------------------- Test YouTube API --------------------
async function testYouTubeAPI(auth) {
  const service = google.youtube("v3");
  try {
    const response = await service.channels.list({
      auth,
      mine: true,
      part: "snippet,contentDetails,statistics",
    });
    const channel = response.data.items[0];
    console.log(`🎉 Authenticated as: ${channel.snippet.title}`);
  } catch (err) {
    console.error("❌ YouTube API test failed:", err);
  }
}

// -------------------- Exported function --------------------
export async function getAuthorizedClient() {
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oAuth2Client.setCredentials(token);
    console.log("✅ Authorized YouTube client ready!");
    return oAuth2Client;
  } else {
    throw new Error("⚠️ No token.json found! Run auth.js manually to generate one first.");
  }
}
