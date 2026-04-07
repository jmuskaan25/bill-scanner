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
      text: 'Extract bill/receipt information and return JSON with these fields: companyName (string), date (YYYY-MM-DD format), totalAmount (number), currency (3-letter code like USD, EUR, INR), taxAmount (number or null), lineItems (array of {description, amount}), category (one of: food, travel, accommodation, office, other). Return ONLY valid JSON, no markdown code fences, no explanation.'
    });

    try {
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
      throw new HttpsError('internal', `Claude API error: ${err.message}`);
    }
  }
);
