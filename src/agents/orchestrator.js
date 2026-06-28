import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize APIs lazily
let genAI = null;
let geminiModel = null;

function getGeminiModel() {
  if (geminiModel) return geminiModel;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key') {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }
  return geminiModel;
}

// Format local date without "Z" suffix to preserve user's local wall clock time
function toLocalISOString(date) {
  const pad = (num) => (num < 10 ? '0' : '') + num;
  return date.getFullYear() +
      '-' + pad(date.getMonth() + 1) +
      '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) +
      ':' + pad(date.getMinutes()) +
      ':' + pad(date.getSeconds());
}

// Chat with Nudge — the main orchestrator
export async function chatWithNudge(message, context = {}) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  const systemPrompt = `You are Nudge, a friendly AI scheduling companion.
Your personality:
- Warm, calm, and competent
- Use short, conversational sentences — never corporate or jargon-heavy
- Always explain WHY before WHAT changed
- Celebrate completions lightly (e.g., "Nice, that's 3 done before lunch 🎉")
- Use emojis naturally

Context:
- Current UTC Time: ${new Date().toISOString()}
- User's Local Clock Time: ${context.localTime || 'Unknown'}
- User's Local Timezone: ${context.timezone || 'Unknown'}
- Tasks: ${JSON.stringify(context.tasks || [])}
- Events: ${JSON.stringify(context.events || [])}
- User: ${JSON.stringify(context.user || {})}

IMPORTANT TIME INSTRUCTIONS:
- Interpret relative times (like "today", "at 3:30", "from 3 to 5") using the User's Local Clock Time: ${context.localTime || 'Unknown'}.
- When returning scheduled_time, you MUST format it as a local ISO datetime string WITHOUT the 'Z' timezone offset suffix (e.g., "2026-06-28T15:30:00"). Do not add 'Z' or '+00:00'. This preserves the time in the user's local timezone.

If the user wants to add, complete, or reschedule tasks, you MUST return a JSON response detailing the actions.
Format your entire response as a JSON object with this exact structure:
{
  "reply": "Your conversational reply to the user explaining what you did",
  "clientActions": [
    // If adding a task:
    {
      "type": "ADD_TASK",
      "payload": {
        "title": "Task title",
        "description": "Task description",
        "scheduled_time": "YYYY-MM-DDTHH:mm:ss local string, e.g. 2026-06-28T15:30:00 (DO NOT add 'Z')",
        "priority": "low/medium/high",
        "type": "work/academic/personal"
      }
    },
    // If completing a task:
    {
      "type": "COMPLETE_TASK",
      "payload": {
        "title": "Task title to match"
      }
    }
  ]
}
If no action is needed, return an empty clientActions array. Return ONLY raw JSON, do not wrap in markdown code blocks.`;

  // 1. Try Groq if key is present
  if (GROQ_API_KEY && GROQ_API_KEY !== 'your_groq_api_key') {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonContent = JSON.parse(data.choices[0].message.content);
        return {
          reply: jsonContent.reply,
          clientActions: jsonContent.clientActions || [],
          agentActions: [{
            agent: 'Orchestrator',
            action: 'Processed query via Groq (Llama 3.3)',
            detail: `Answered user query and mapped ${jsonContent.clientActions?.length || 0} client actions.`,
          }],
        };
      } else {
        const errText = await response.text();
        console.error('Groq API error:', errText);
      }
    } catch (error) {
      console.error('Groq chat error:', error);
    }
  }

  // 2. Try Gemini if key is present
  const activeGeminiModel = getGeminiModel();
  if (activeGeminiModel) {
    try {
      const result = await activeGeminiModel.generateContent({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + message }] }
        ],
      });

      let text = result.response.text().trim();
      // Clean up markdown blocks if model ignored system prompt rule
      if (text.startsWith('```json')) text = text.replace(/^```json/, '').replace(/```$/, '');
      else if (text.startsWith('```')) text = text.replace(/^```/, '').replace(/```$/, '');
      
      const jsonContent = JSON.parse(text);
      return {
        reply: jsonContent.reply,
        clientActions: jsonContent.clientActions || [],
        agentActions: [{
          agent: 'Orchestrator',
          action: 'Processed query via Gemini',
          detail: `Answered user query and mapped ${jsonContent.clientActions?.length || 0} client actions.`,
        }],
      };
    } catch (error) {
      console.error('Gemini chat error:', error);
    }
  }

  // 3. Fallback to Smart Context-Aware Fallback Engine
  return getFallbackResponse(message, context);
}

// Smart fallback when LLMs are not available
function getFallbackResponse(message, context) {
  const lower = message.toLowerCase();
  let reply = '';
  const agentActions = [];
  const clientActions = [];
  const tasks = context.tasks || [];
  const events = context.events || [];

  const formatTime = (isoString) => {
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return 'some time';
    }
  };

  // Check if they want to ADD a task
  if (lower.startsWith('add ') || lower.startsWith('schedule ') || lower.startsWith('create ')) {
    let title = message.replace(/^(add|schedule|create)\s+/i, '');
    let date = new Date();
    
    if (lower.includes('today')) {
      title = title.replace(/\btoday\b/gi, '');
    }
    
    // Parse time (e.g. 3 to 5, 3pm, 15:30)
    const timeMatch = title.match(/(?:from|at|between)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const ampm = timeMatch[3];
      if (ampm && ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
      if (ampm && ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
      
      // Default to PM for waking hours if not specified
      if (!ampm && hours >= 1 && hours <= 8) hours += 12;

      date.setHours(hours, minutes, 0, 0);
      title = title.replace(/(?:from|at|between)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, '');
    }
    
    title = title.trim();
    const scheduled_time = toLocalISOString(date);

    reply = `Got it! I've added the task "**${title}**" to your schedule for today at ${formatTime(scheduled_time)}. 📅`;
    clientActions.push({
      type: 'ADD_TASK',
      payload: {
        title,
        description: 'Added via chat assistant',
        scheduled_time,
        priority: 'medium',
        type: 'task',
      }
    });
    agentActions.push({ 
      agent: 'Execution', 
      action: 'Created task', 
      detail: `Created task "${title}" scheduled for ${formatTime(scheduled_time)}.` 
    });
  }
  // Check if they want to COMPLETE a task
  else if (lower.startsWith('complete ') || lower.startsWith('done ') || lower.startsWith('mark ')) {
    let title = message.replace(/^(complete|done|mark)\s+/i, '').replace(/\s+as done$/i, '');
    title = title.trim();

    reply = `Done! I've marked "**${title}**" as completed. 🎉`;
    clientActions.push({
      type: 'COMPLETE_TASK',
      payload: { title }
    });
    agentActions.push({ 
      agent: 'Execution', 
      action: 'Completed task', 
      detail: `Marked task matching "${title}" as done.` 
    });
  }
  // General schedule queries
  else if (lower.includes('schedule') || lower.includes('calendar') || lower.includes('event') || lower.includes('today') || lower.includes('plan')) {
    const eventList = events.map(e => `• **${e.title}** (${formatTime(e.start?.dateTime || e.start)})`).join('\n');
    const taskList = tasks.filter(t => t.status !== 'done').map(t => `• **${t.title}** [${t.priority}]`).join('\n');

    reply = `Here is your real-time schedule for today:\n\n` +
      `📅 **Events (${events.length}):**\n${eventList || 'No calendar events today! 🌴'}\n\n` +
      `📋 **Pending Tasks (${tasks.filter(t => t.status !== 'done').length}):**\n${taskList || 'No pending tasks! All clear. 🎉'}\n\n` +
      `Would you like me to reschedule anything or help you plan?`;
      
    agentActions.push({ 
      agent: 'Planner', 
      action: 'Aggregated today\'s schedule', 
      detail: `Fetched ${events.length} events and ${tasks.length} tasks from local context.` 
    });
  } 
  else if (lower.includes('urgent') || lower.includes('priority') || lower.includes('important')) {
    const urgentTask = tasks.find(t => t.priority === 'high' && t.status !== 'done') || tasks.find(t => t.status !== 'done');
    
    if (urgentTask) {
      reply = `Your most urgent task right now is **${urgentTask.title}** (Priority: ${urgentTask.priority.toUpperCase()}). 🎯\n\n` +
        `Description: ${urgentTask.description || 'No description provided'}.\n\n` +
        `Should we set a focused block in your calendar to complete this?`;
      agentActions.push({ 
        agent: 'Planner', 
        action: 'Identified urgent task', 
        detail: `Found high-priority task: "${urgentTask.title}"` 
      });
    } else {
      reply = `You have no pending high-priority tasks right now! Great job staying ahead. 🌟`;
      agentActions.push({ 
        agent: 'Planner', 
        action: 'Scanned priorities', 
        detail: 'No urgent items found.' 
      });
    }
  } 
  else if (lower.includes('free') || lower.includes('clear') || lower.includes('gap') || lower.includes('break')) {
    if (events.length === 0) {
      reply = `Your day is completely clear! ☀️ You have 0 calendar events. It's a perfect time to focus on personal projects or take a breather.`;
    } else {
      reply = `You have ${events.length} events today. There is a nice gap in your schedule between meetings. Would you like me to carve out a 1-hour Deep Work block for you? 📅`;
    }
    agentActions.push({ 
      agent: 'Scheduler', 
      action: 'Analyzed gaps', 
      detail: `Checked event schedule to locate free slots.` 
    });
  } 
  else if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey')) {
    const firstName = context.user?.displayName?.split(' ')[0] || 'there';
    reply = `Hey ${firstName}! 👋 I'm Nudge, your scheduling companion. I've got your real-time schedule loaded.\n\n` +
      `Ask me anything, like "what's my schedule?" or "do I have any urgent tasks?"!`;
    agentActions.push({ 
      agent: 'Orchestrator', 
      action: 'Greeted user', 
      detail: 'Initiated conversation' 
    });
  }
  else {
    reply = `I'm scanning your schedule... 🔍\n\n` +
      `You currently have ${events.length} events and ${tasks.filter(t => t.status !== 'done').length} pending tasks.\n\n` +
      `Try saying "add study at 3pm today" or "complete study"!`;
    agentActions.push({ 
      agent: 'Orchestrator', 
      action: 'General query processed', 
      detail: `Interpreted: "${message.substring(0, 50)}"` 
    });
  }

  return { reply, agentActions, clientActions };
}

export default { chatWithNudge };
