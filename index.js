const admin = require("firebase-admin");
const express = require("express");
const app = express();

/**
 * --- CONFIGURATION ---
 * Ensure you set the FIREBASE_SERVICE_ACCOUNT environment variable on Render
 * with the contents of your Firebase Service Account JSON file.
 */
const dbURL = "https://dhiboi-default-rtdb.firebaseio.com";
const saContent = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!saContent) {
  console.error("************************************************************");
  console.error("FATAL ERROR: FIREBASE_SERVICE_ACCOUNT is missing!");
  console.error("Action: Go to Render Dashboard -> Settings -> Environment Variables");
  console.error("Value: Paste your entire Firebase Service Account JSON here.");
  console.error("************************************************************");
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

try {
  const serviceAccount = JSON.parse(saContent || "{}");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: dbURL
  });
  console.log("Firebase Admin Initialized Successfully. 🚀");
} catch (e) {
  console.error("FATAL ERROR: Invalid Service Account JSON:", e.message);
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const db = admin.database();

console.log("FCM High-Priority Server Monitoring fcm_queue...");

/**
 * Sends a single high-priority FCM message to wake up the target device.
 */
async function sendWakeupSignal(uid, token) {
  if (!token) {
    console.warn(`[SKIP] No registration token found for UID: ${uid}`);
    return;
  }

  const message = {
    token: token,
    data: {
      t: "WAKE_UP",
      ts: Date.now().toString(),
      p: "high"
    },
    android: {
      priority: "high",
      ttl: 3600 * 1000 
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`[SUCCESS] High-priority signal delivered to ${uid}. ID: ${response}`);
  } catch (error) {
    console.error(`[CRITICAL] FCM Transmission Error for ${uid}:`, error.message);
  }
}

/**
 * REALTIME QUEUE LISTENER
 */
db.ref("fcm_queue").on("child_added", async (snapshot) => {
  const queueId = snapshot.key;
  const payload = snapshot.val();

  if (!payload || !payload.targetUid) {
    return db.ref(`fcm_queue/${queueId}`).remove();
  }

  const targetUid = payload.targetUid;
  console.log(`[QUEUE] Triggering wakeup sequence for: ${targetUid}`);

  try {
    if (targetUid === "ALL") {
      const usersSnap = await db.ref("Users").once("value");
      const users = usersSnap.val() || {};
      const uids = Object.keys(users);
      const messages = [];

      uids.forEach(uid => {
        const token = users[uid].I ? users[uid].I.tk : null;
        if (token) {
          messages.push({
            token: token,
            data: { t: "WAKE_UP", ts: Date.now().toString() },
            android: { priority: "high" }
          });
        }
      });

      if (messages.length > 0) {
        const result = await admin.messaging().sendEach(messages);
        console.log(`[BROADCAST] Result -> Success: ${result.successCount}, Failure: ${result.failureCount}`);
      }
    } else {
      const userTokenSnap = await db.ref(`Users/${targetUid}/I/tk`).once("value");
      const token = userTokenSnap.val();
      await sendWakeupSignal(targetUid, token);
    }
  } catch (err) {
    console.error(`[ERROR] Processing queue task ${queueId}:`, err.message);
  } finally {
    db.ref(`fcm_queue/${queueId}`).remove();
  }
});

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>BOI FCM Status: ONLINE</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: white; text-align: center; padding-top: 20vh;">
        <h1>FCM Service Active</h1>
        <p>Target Database: ${dbURL}</p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] FCM Relay Node started on port ${PORT}`);
});
