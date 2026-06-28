import { Router } from 'express';
import { google } from 'googleapis';

const router = Router();

// POST /api/auth/google — exchange authorization code for tokens
router.post('/google', async (req, res) => {
  try {
    const { code, idToken } = req.body;
    
    // In production, exchange the auth code for access/refresh tokens
    // using Google OAuth2 client. For demo, we accept the ID token directly.
    if (idToken) {
      // Verify ID token with Firebase Admin SDK
      // For now, just acknowledge
      res.json({ 
        success: true, 
        message: 'Authentication successful',
      });
    } else {
      res.status(400).json({ error: 'No token provided' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /api/auth/me — get current user info
router.get('/me', async (req, res) => {
  // In production, verify the Bearer token from the request
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({ 
    authenticated: true,
    message: 'Token is valid',
  });
});

// POST /api/auth/welcome — send welcome email
router.post('/welcome', async (req, res) => {
  try {
    const { email, name } = req.body;
    const googleToken = req.headers['x-google-token'];
    
    if (!googleToken || !email) {
      return res.status(400).json({ error: 'Missing token or email' });
    }
    
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const firstName = name?.split(' ')[0] || 'there';
    
    const message = [
      'From: Nudge Team <hello@nudge.app>',
      `To: ${email}`,
      'Subject: Welcome to your new stress-free life! 🧘‍♂️',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      `Hey ${firstName},`,
      '',
      'Welcome to Nudge! We are absolutely thrilled you chose us.',
      'Get ready to say goodbye to calendar chaos and hello to a brilliantly organized, stress-free life.',
      '',
      'Seriously, put your feet up. Have a completely stressless life ahead! We’ve got your schedule handled.',
      '',
      'Cheers,',
      'The Nudge Team ⚡'
    ].join('\n');
    
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
      
    await gmail.users.messages.insert({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        labelIds: ['INBOX', 'UNREAD']
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Welcome email error:', error);
    res.status(500).json({ error: 'Failed to send welcome email' });
  }
});

export default router;
