import { Router } from 'express';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';

const router = Router();

// GET /api/gmail/triage — fetch recent unread emails and turn into triage items
router.get('/triage', async (req, res) => {
  try {
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken) {
      return res.status(401).json({ error: 'No Google token provided' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Fetch last 10 unread messages in INBOX
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox',
      maxResults: 10,
    });

    const messages = response.data.messages || [];
    const triageItems = [];

    for (const msg of messages) {
      const details = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const headers = details.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
      
      // Simple heuristic: if it looks actionable or important, add it
      // For MVP, we'll just add all of them, but you'd normally use Gemini here
      
      // Extract sender name from "Name <email>" format
      const senderName = from.split('<')[0].trim().replace(/"/g, '') || from;
      
      triageItems.push({
        id: `triage-${randomUUID()}`,
        title: subject,
        description: `Found in email from ${senderName}`,
        source: 'gmail',
        sender: senderName,
        suggested_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        priority: 'medium',
        type: 'work',
        created_at: new Date().toISOString(),
      });
    }

    res.json({ items: triageItems });
  } catch (error) {
    console.error('Gmail triage error:', error);
    res.status(500).json({ error: 'Failed to fetch Gmail triage items' });
  }
});

export default router;
