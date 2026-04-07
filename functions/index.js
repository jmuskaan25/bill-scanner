const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const Anthropic = require('@anthropic-ai/sdk');

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
