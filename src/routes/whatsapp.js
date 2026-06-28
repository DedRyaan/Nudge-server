import { Router } from 'express';

const router = Router();

const MOCK_MODE = process.env.WHATSAPP_MOCK_MODE !== 'false';

// Mock message log for demo
const messageLog = [];

// GET /api/whatsapp/webhook — Meta webhook verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'nudge-verify-token';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST /api/whatsapp/webhook — incoming messages from WhatsApp
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (MOCK_MODE) {
      console.log('📱 [MOCK] WhatsApp incoming:', JSON.stringify(body, null, 2));
      messageLog.push({
        direction: 'incoming',
        body,
        timestamp: new Date().toISOString(),
      });
      return res.sendStatus(200);
    }

    // Process real WhatsApp messages
    if (body.object === 'whatsapp_business_account') {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const messages = change.value?.messages || [];
          for (const message of messages) {
            await handleIncomingMessage(message);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.sendStatus(500);
  }
});

// POST /api/whatsapp/send — send a message via WhatsApp
router.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body;

    if (MOCK_MODE) {
      console.log(`📱 [MOCK] WhatsApp send to ${to}: ${message}`);
      messageLog.push({
        direction: 'outgoing',
        to,
        message,
        timestamp: new Date().toISOString(),
      });
      return res.json({ 
        success: true, 
        mock: true,
        message: 'Message logged (mock mode)',
      });
    }

    // Real WhatsApp Cloud API send
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('WhatsApp send error:', error);
    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// GET /api/whatsapp/log — get mock message log (dev only)
router.get('/log', (req, res) => {
  res.json({ messages: messageLog });
});

// Handle incoming WhatsApp messages
async function handleIncomingMessage(message) {
  const text = message.text?.body?.toLowerCase() || '';
  const from = message.from;

  console.log(`📱 WhatsApp from ${from}: ${text}`);

  // Parse common commands
  if (text === 'done' || text.includes('finished') || text.includes('completed')) {
    // Mark the most recent pending task as done
    // In production: update Firestore → triggers real-time sync to app
    console.log(`✅ User marked task as done via WhatsApp`);
  } else if (text.startsWith('snooze') || text.includes('later')) {
    // Snooze the most recent task
    const hours = parseInt(text.match(/\d+/)?.[0]) || 2;
    console.log(`😴 User snoozed task for ${hours} hours via WhatsApp`);
  } else {
    // Treat as a general query — route to assistant
    console.log(`💬 User query via WhatsApp: ${text}`);
  }
}

export default router;
