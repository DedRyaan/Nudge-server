import { google } from 'googleapis';

const activeSyncs = new Map();

export function startCalendarSync(io) {
  io.on('connection', (socket) => {
    
    // When the client connects, they can send their google token
    socket.on('register_google_token', ({ userId, googleToken }) => {
      if (!googleToken) return;
      
      // Stop existing sync for this socket if any
      if (activeSyncs.has(socket.id)) {
        clearInterval(activeSyncs.get(socket.id).interval);
      }

      console.log(`[CalendarSync] Starting 1.5s polling for client ${socket.id}`);
      
      // We will track the last updated timestamp to compare
      let lastKnownSyncToken = null;
      let isFirstPoll = true;
      
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: googleToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const pollGoogleCalendar = async () => {
        try {
          // Time min is roughly now, time max is 7 days from now (to match the frontend)
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

          // Check if there are newly updated events since last poll
          if (response.data.items && response.data.items.length > 0) {
            if (!isFirstPoll) {
               console.log(`[CalendarSync] Detected ${response.data.items.length} changes, pushing to client ${socket.id}`);
               // Emit to the specific socket
               socket.emit('CALENDAR_UPDATED', { timestamp: new Date().toISOString() });
            }
          }
          
          isFirstPoll = false;
          // Remember the time we just polled
          lastKnownSyncToken = new Date(Date.now() - 1500).toISOString(); // subtract 1.5s just in case
          
        } catch (error) {
          // Token might be expired or invalid
          if (error.code === 401 || (error.response && error.response.status === 401)) {
            console.log(`[CalendarSync] Google token expired for ${socket.id}, stopping poll.`);
            clearInterval(activeSyncs.get(socket.id)?.interval);
            activeSyncs.delete(socket.id);
          } else {
             // Silently catch network errors
          }
        }
      };

      // Poll every 1.5 seconds
      const interval = setInterval(pollGoogleCalendar, 1500);
      
      // Initial poll
      pollGoogleCalendar();
      
      activeSyncs.set(socket.id, { interval });
    });

    socket.on('disconnect', () => {
      if (activeSyncs.has(socket.id)) {
        clearInterval(activeSyncs.get(socket.id).interval);
        activeSyncs.delete(socket.id);
      }
    });
  });
}
