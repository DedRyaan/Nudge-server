import { Router } from 'express';
import { google } from 'googleapis';

const router = Router();

// GET /api/calendar/events — fetch calendar events
router.get('/events', async (req, res) => {
  try {
    const { timeMin, timeMax } = req.query;
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken) {
      return res.status(401).json({ error: 'No Google token provided' });
    }

    // Create OAuth2 client with the user's access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = (response.data.items || []).map(event => ({
      id: event.id,
      title: event.summary || 'Untitled',
      description: event.description || '',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      location: event.location || '',
      source: 'google',
      type: categorizeEvent(event.summary),
      color: '#5b8def',
      htmlLink: event.htmlLink,
    }));

    res.json({ events });
  } catch (error) {
    console.error('Calendar fetch error:', error.message);
    
    // If token is expired/invalid, return demo events
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      return res.json({ 
        events: [],
        demo: true,
        message: 'Using demo data — Google Calendar not connected',
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// POST /api/calendar/events — create a new calendar event
router.post('/events', async (req, res) => {
  try {
    const { title, start, end, description } = req.body;
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken) {
      return res.status(401).json({ error: 'No Google token provided' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: title,
        description: description || '',
        start: { dateTime: start },
        end: { dateTime: end },
      },
    });

    res.json({ 
      success: true, 
      event: {
        id: event.data.id,
        title: event.data.summary,
        start: event.data.start?.dateTime,
        end: event.data.end?.dateTime,
      }
    });
  } catch (error) {
    console.error('Calendar create error:', error.message);
    res.status(500).json({ error: 'Failed to create event' });
  }
});
// PUT /api/calendar/events/:id — update an existing calendar event
router.put('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, start, end, description } = req.body;
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken) {
      return res.status(401).json({ error: 'No Google token provided' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    // First get the existing event to keep any data we aren't explicitly updating
    const existing = await calendar.events.get({
      calendarId: 'primary',
      eventId: id,
    });
    
    const event = await calendar.events.update({
      calendarId: 'primary',
      eventId: id,
      requestBody: {
        ...existing.data,
        summary: title || existing.data.summary,
        description: description !== undefined ? description : existing.data.description,
        start: start ? { dateTime: start } : existing.data.start,
        end: end ? { dateTime: end } : existing.data.end,
      },
    });

    res.json({ success: true, event: event.data });
  } catch (error) {
    console.error('Calendar update error:', error.message);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/calendar/events/:id — delete a calendar event
router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken) {
      return res.status(401).json({ error: 'No Google token provided' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: id,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Calendar delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// POST /api/calendar/webhook — handle push notifications from Google Calendar
router.post('/webhook', (req, res) => {
  const userId = req.headers['x-goog-channel-token'];
  const resourceState = req.headers['x-goog-resource-state'];
  const channelId = req.headers['x-goog-channel-id'];
  
  console.log(`[Webhook] Received calendar notification: channel=${channelId}, state=${resourceState}, user=${userId}`);

  if (resourceState === 'exists' && userId && req.io) {
    console.log(`[Webhook] Pushing CALENDAR_UPDATED to user: ${userId}`);
    req.io.to(userId).emit('CALENDAR_UPDATED', { timestamp: new Date().toISOString() });
  }

  res.status(200).send('OK');
});

// Helper: categorize events by title keywords
function categorizeEvent(summary = '') {
  const lower = summary.toLowerCase();
  if (lower.includes('class') || lower.includes('lecture') || lower.includes('study') || lower.includes('prof') || lower.includes('exam')) {
    return 'academic';
  }
  if (lower.includes('gym') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('personal')) {
    return 'personal';
  }
  if (lower.includes('meeting') || lower.includes('standup') || lower.includes('review') || lower.includes('sync')) {
    return 'meeting';
  }
  return 'event';
}

export default router;
