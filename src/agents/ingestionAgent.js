// Ingestion Agent — pulls from Gmail/Calendar/WhatsApp
// Extracts implicit deadlines and pushes to Triage Panel

export async function extractDeadlinesFromEmail(emailContent) {
  // Pattern matching for common deadline phrases
  const patterns = [
    /due\s+(?:by\s+)?(?:on\s+)?([\w\s,]+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?)/gi,
    /deadline[:\s]+(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
    /submit\s+(?:by|before)\s+([\w\s,]+\d{1,2}(?:st|nd|rd|th)?)/gi,
    /(?:before|by)\s+([\w\s,]+\d{1,2}(?:st|nd|rd|th)?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?)/gi,
  ];

  const deadlines = [];
  
  for (const pattern of patterns) {
    const matches = emailContent.matchAll(pattern);
    for (const match of matches) {
      deadlines.push({
        rawDate: match[1].trim(),
        context: match[0].trim(),
        confidence: 0.8,
      });
    }
  }

  return deadlines;
}

export async function processEmailForTriage(email) {
  const deadlines = await extractDeadlinesFromEmail(email.body || '');
  
  if (deadlines.length === 0) {
    return null; // Nothing to triage
  }

  return {
    title: email.subject || 'Task from email',
    description: `Found in email from ${email.from} — "${deadlines[0].context}"`,
    source: 'gmail',
    sender: email.from,
    suggested_time: null, // Would parse the date in production
    priority: deadlines[0].confidence > 0.7 ? 'high' : 'medium',
    type: 'task',
    rawDeadlines: deadlines,
  };
}

export async function processWhatsAppForTriage(message) {
  // Simple keyword extraction from WhatsApp messages
  const text = message.text || '';
  const lower = text.toLowerCase();
  
  // Check if this looks like a task/deadline
  const hasDeadline = /due|deadline|submit|before|by tomorrow|this week/i.test(text);
  const hasEvent = /dinner|lunch|meeting|call|party/i.test(text);
  
  if (!hasDeadline && !hasEvent) {
    return null;
  }

  return {
    title: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
    description: `WhatsApp message from ${message.from} — "${text}"`,
    source: 'whatsapp',
    sender: message.from,
    suggested_time: null,
    priority: hasDeadline ? 'medium' : 'low',
    type: hasEvent ? 'event' : 'task',
  };
}

export default { extractDeadlinesFromEmail, processEmailForTriage, processWhatsAppForTriage };
