import { google } from 'googleapis';
import crypto from 'crypto';

const activeSyncs = new Map();
const activeWebhooks = new Set(); // Track users with active webhooks to avoid duplicate registrations

// Helper: categorize events by title keywords (matches routes/calendar.js)
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

// Helper to map Google API event format to Nudge frontend event format
function mapEvent(event) {
  return {
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
    status: event.status // 'confirmed', 'tentative', or 'cancelled'
  };
}

export function startCalendarSync(io) {
  io.on('connection', (socket) => {
    
    // When the client connects, they can send their google token
    socket.on('register_google_token', ({ userId, googleToken }) => {
      if (!googleToken) return;
      
      // Stop existing sync for this socket if any
      if (activeSyncs.has(socket.id)) {
        const existing = activeSyncs.get(socket.id);
        if (existing.interval) clearInterval(existing.interval);
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: googleToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const webhookUrl = process.env.WEBHOOK_URL;

      const startPolling = () => {
        console.log(`[CalendarSync] Starting 1.5s polling fallback for client ${socket.id}`);
        
        let lastKnownSyncToken = null;
        let isFirstPoll = true;

        const pollGoogleCalendar = async () => {
          try {
            const timeMin = new Date().toISOString();
            const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            
            const response = await calendar.events.list({
              calendarId: 'primary',
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: 'startTime',
              updatedMin: !isFirstPoll && lastKnownSyncToken ? lastKnownSyncToken : undefined,
            });

            if (response.data.items && response.data.items.length > 0) {
              if (!isFirstPoll) {
                 console.log(`[CalendarSync] Polling detected ${response.data.items.length} changes for client ${socket.id}`);
                 const mapped = response.data.items.map(mapEvent);
                 socket.emit('CALENDAR_UPDATED', { 
                   timestamp: new Date().toISOString(),
                   updatedEvents: mapped
                 });
              }
            }
            
            isFirstPoll = false;
            lastKnownSyncToken = new Date(Date.now() - 1500).toISOString();
            
          } catch (error) {
            if (error.code === 401 || (error.response && error.response.status === 401)) {
              console.log(`[CalendarSync] Google token expired for ${socket.id}, stopping poll.`);
              clearInterval(activeSyncs.get(socket.id)?.interval);
              activeSyncs.delete(socket.id);
            }
          }
        };

        const interval = setInterval(pollGoogleCalendar, 1500);
        pollGoogleCalendar();
        
        activeSyncs.set(socket.id, { interval });
      };

      const registerWebhook = async () => {
        if (activeWebhooks.has(userId)) {
          console.log(`[CalendarSync] Webhook already active for user ${userId}. Skipping registration.`);
          activeSyncs.set(socket.id, { webhook: true });
          return;
        }

        try {
          const channelId = crypto.randomUUID();
          console.log(`[CalendarSync] Registering Google Calendar webhook for user ${userId} (Channel: ${channelId})`);
          
          await calendar.events.watch({
            requestBody: {
              id: channelId,
              type: 'web_hook',
              address: `${webhookUrl}/api/calendar/webhook`,
              token: userId,
            },
          });
          
          console.log(`[CalendarSync] Webhook successfully registered for user ${userId}`);
          activeWebhooks.add(userId);
          activeSyncs.set(socket.id, { webhook: true });
        } catch (error) {
          console.error(`[CalendarSync] Webhook registration failed for user ${userId}, falling back to polling:`, error.message);
          startPolling();
        }
      };

      if (webhookUrl && webhookUrl !== 'your_server_webhook_url') {
        registerWebhook();
      } else {
        startPolling();
      }
    });

    socket.on('disconnect', () => {
      if (activeSyncs.has(socket.id)) {
        const existing = activeSyncs.get(socket.id);
        if (existing.interval) clearInterval(existing.interval);
        activeSyncs.delete(socket.id);
      }
    });
  });
}
