import './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import taskRoutes from './routes/tasks.js';
import agentRoutes from './routes/agents.js';
import whatsappRoutes from './routes/whatsapp.js';
import gmailRoutes from './routes/gmail.js';
import { startCalendarSync } from './services/calendarSync.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/gmail', gmailRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Nudge Orchestrator',
    timestamp: new Date().toISOString(),
  });
});

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(err.status || 500).json({
    error: true,
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message,
  });
});


// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  // The client can join a room based on their user ID or just receive broadcast events
  socket.on('register', (data) => {
    if (data.userId) {
      socket.join(data.userId);
      console.log(`[Socket] Client ${socket.id} joined room ${data.userId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Start Calendar Sync Service
startCalendarSync(io);

httpServer.listen(PORT, () => {
  console.log(`\n⚡ Nudge Orchestrator running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   WhatsApp Mock: ${process.env.WHATSAPP_MOCK_MODE !== 'false' ? 'ON' : 'OFF'}\n`);
});

export default httpServer;
