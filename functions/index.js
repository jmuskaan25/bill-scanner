const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const SHEET_ID = '1dMsOc77yzB1OtTDmrr74Ba3-RaaipJYqFd663FRwImE';

const claudeApiKey = defineSecret('CLAUDE_API_KEY');

exports.scanBill = onCall(
  {
    secrets: [claudeApiKey],
    timeoutSeconds: 60,
    invoker: 'public',
    ingress: 'internal-and-cloud-load-balancing',
  },
  async (request) => {
    const { imageBase64, mediaType } = request.data;

    if (!imageBase64 || !mediaType) {
      throw new HttpsError('invalid-argument', 'imageBase64 and mediaType are required');
    }

    const client = new Anthropic({ apiKey: claudeApiKey.value() });

    const contentBlocks = [];
    if (mediaType === 'application/pdf') {
      contentBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 }
      });
    } else {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 }
      });
    }
    contentBlocks.push({
      type: 'text',
      text: 'Extract ride/cab receipt information and return JSON with these exact fields:\n- provider: string (e.g. "Uber", "Rapido", "Ola", "Auto" — infer from logo/brand)\n- rideId: string (booking ID, ride ID, or trip ID)\n- riderName: string (customer/passenger name on the receipt)\n- driverName: string (driver name if present, else null)\n- vehicleNumber: string (license plate if present, else null)\n- pickup: string (source/pickup address)\n- drop: string (destination/drop address)\n- date: string (YYYY-MM-DD format)\n- totalAmount: number (final amount paid)\n- currency: string (3-letter code, e.g. "INR")\n- paymentMethod: string ("cash", "upi", or "card")\n\nReturn ONLY valid JSON, no markdown, no explanation.'
    });

    try {
      console.log('Calling Anthropic API, key prefix:', claudeApiKey.value().substring(0, 20));
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: contentBlocks }]
      });

      const text = response.content[0].text.trim();
      let jsonStr = text;
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      return JSON.parse(jsonStr);
    } catch (err) {
      console.error('Anthropic error:', err.constructor.name, err.message, err.status, err.error);
      throw new HttpsError('internal', `Claude API error: ${err.constructor.name}: ${err.message}`);
    }
  }
);

// ---- Sync new reimbursement to Google Sheet ----
exports.syncToSheet = onDocumentCreated(
  'reimbursements/{docId}',
  async (event) => {
    const data = event.data.data();
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const row = [
      event.data.id,
      data.submittedBy || '',
      data.email || '',
      data.provider || '',
      data.rideId || '',
      data.date || '',
      data.pickup || '',
      data.drop || '',
      data.totalAmount != null ? data.totalAmount : '',
      data.currency || '',
      data.paymentMethod || '',
      data.purpose || '',
      data.status || 'pending',
      data.imageUrl || '',
      data.submittedAt?.toDate?.().toISOString() || new Date().toISOString(),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:O',
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });

    console.log('Synced doc', event.data.id, 'to sheet');
  }
);

// ---- Update status in Google Sheet ----
exports.updateSheetStatus = onCall(
  { timeoutSeconds: 30 },
  async (request) => {
    const { docId, status } = request.data;
    if (!docId || !status) {
      throw new HttpsError('invalid-argument', 'docId and status required');
    }

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Find the row with this docId (column A)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:A',
    });

    const rows = res.data.values || [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === docId) {
        rowIndex = i + 1; // 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      console.warn('Doc not found in sheet:', docId);
      return { updated: false };
    }

    // Update column M (status, 13th column)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Sheet1!M${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    });

    return { updated: true, row: rowIndex };
  }
);

// ---- Backfill: sync all existing Firestore docs to Google Sheet ----
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

exports.backfillSheet = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    const db = admin.firestore();
    const snapshot = await db.collection('reimbursements').get();

    if (snapshot.empty) return { synced: 0 };

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Clear existing data (keep header row)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A2:O',
    });

    const rows = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      rows.push([
        doc.id,
        d.submittedBy || '',
        d.email || '',
        d.provider || '',
        d.rideId || '',
        d.date || '',
        d.pickup || '',
        d.drop || '',
        d.totalAmount != null ? d.totalAmount : '',
        d.currency || '',
        d.paymentMethod || '',
        d.purpose || '',
        d.status || 'pending',
        d.imageUrl || '',
        d.submittedAt?.toDate?.().toISOString() || '',
      ]);
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:O',
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    console.log(`Backfilled ${rows.length} docs to sheet`);
    return { synced: rows.length };
  }
);
