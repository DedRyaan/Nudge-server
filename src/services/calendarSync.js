import { google } from 'googleapis';
import crypto from 'crypto';

const activeSyncs = new Map();
const activeWebhooks = new Set(); // Track users with active webhooks to avoid duplicate registrations

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
                 socket.emit('CALENDAR_UPDATED', { timestamp: new Date().toISOString() });
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
            calendarId: 'primary',
            requestBody: {
              id: channelId,
              type: 'web_hook',
              address: `${webhookUrl}/api/calendar/webhook`,
              token: userId, // Google passes this back as X-Goog-Channel-Token header
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
