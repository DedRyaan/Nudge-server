import { Router } from 'express';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
    if (messages.length === 0) {
      return res.json({ items: [] });
    }

    const emailList = [];

    // Fetch details and snippets
    for (const msg of messages) {
      const details = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const headers = details.data.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      const snippet = details.data.snippet || '';
      
      const senderName = from.split('<')[0].trim().replace(/"/g, '') || from;

      emailList.push({
        id: msg.id,
        sender: senderName,
        subject,
        date,
        snippet,
      });
    }

    // Call LLM to classify and extract actionable emails
    let classifiedItems = [];
    const systemPrompt = `You are a smart email assistant for Nudge. Your job is to filter unread emails and identify which ones contain scheduling requests, events, meetings, appointments, deadlines, or actionable tasks that should be scheduled on a calendar.
For each email, decide if it should "come through" to the calendar dashboard.
Only say YES if the email contains an event to schedule, a deadline, a meeting request, or a task with a clear time/due date.
Otherwise, say NO.

Format your entire response as a JSON object with this exact structure:
{
  "classifications": [
    {
      "emailId": "the_id_of_the_email",
      "shouldComeThrough": true/false,
      "extractedEvent": {
        "title": "Clean, short title for the event/task",
        "description": "Brief description of the event or task (1-2 sentences)",
        "suggested_time": "Estimated or extracted ISO datetime string (YYYY-MM-DDTHH:mm:ss) in local time if found, or null",
        "priority": "low/medium/high",
        "type": "work/academic/personal"
      }
    }
  ]
}`;

    const userPrompt = `Classify these emails:\n${JSON.stringify(emailList, null, 2)}`;
    let success = false;

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    // 1. Try Groq (Llama 3)
    if (GROQ_API_KEY && GROQ_API_KEY !== 'your_groq_api_key') {
      try {
        console.log('[GmailTriage] Querying Groq for email classification...');
        const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          })
        });

        if (llmResponse.ok) {
          const data = await llmResponse.json();
          const parsed = JSON.parse(data.choices[0].message.content);
          classifiedItems = parsed.classifications || [];
          success = true;
          console.log(`[GmailTriage] Groq classified ${classifiedItems.filter(c => c.shouldComeThrough).length} emails as actionable.`);
        }
      } catch (err) {
        console.error('[GmailTriage] Groq classification failed:', err.message);
      }
    }

    // 2. Try Gemini fallback
    if (!success && GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key') {
      try {
        console.log('[GmailTriage] Querying Gemini for email classification...');
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt + '\n\nEmails:\n' + userPrompt }] }
          ],
        });

        let text = result.response.text().trim();
        if (text.startsWith('```json')) text = text.replace(/^```json/, '').replace(/```$/, '');
        else if (text.startsWith('```')) text = text.replace(/^```/, '').replace(/```$/, '');

        const parsed = JSON.parse(text);
        classifiedItems = parsed.classifications || [];
        success = true;
        console.log(`[GmailTriage] Gemini classified ${classifiedItems.filter(c => c.shouldComeThrough).length} emails as actionable.`);
      } catch (err) {
        console.error('[GmailTriage] Gemini classification failed:', err.message);
      }
    }

    const triageItems = [];

    // 3. Heuristic fallback (if both LLMs fail or aren't configured)
    if (!success) {
      console.log('[GmailTriage] Falling back to basic keyword heuristics...');
      const keywords = ['meeting', 'schedule', 'calendar', 'appointment', 'due', 'deadline', 'event', 'class', 'lecture', 'zoom', 'call', 'sync', 'invite', 'reminder'];
      
      for (const email of emailList) {
        const textToSearch = `${email.subject} ${email.snippet}`.toLowerCase();
        const matchesKeyword = keywords.some(keyword => textToSearch.includes(keyword));

        if (matchesKeyword) {
          triageItems.push({
            id: `triage-${randomUUID()}`,
            title: email.subject,
            description: `Heuristic: Found in email from ${email.sender}`,
            source: 'gmail',
            sender: email.sender,
            suggested_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            priority: 'medium',
            type: 'work',
            created_at: new Date().toISOString(),
          });
        }
      }
    } else {
      // Build triage items from LLM classifications
      for (const item of classifiedItems) {
        if (item.shouldComeThrough) {
          const origEmail = emailList.find(e => e.id === item.emailId);
          if (!origEmail) continue;

          triageItems.push({
            id: `triage-${randomUUID()}`,
            title: item.extractedEvent?.title || origEmail.subject,
            description: item.extractedEvent?.description || `Found in email from ${origEmail.sender}`,
            source: 'gmail',
            sender: origEmail.sender,
            suggested_time: item.extractedEvent?.suggested_time || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            priority: item.extractedEvent?.priority || 'medium',
            type: item.extractedEvent?.type || 'work',
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    res.json({ items: triageItems });
  } catch (error) {
    console.error('Gmail triage error:', error);
    res.status(500).json({ error: 'Failed to fetch Gmail triage items' });
  }
});

export default router;
