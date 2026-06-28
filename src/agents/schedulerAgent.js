import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let model = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key') {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export async function scheduleTasks(tasks = [], events = []) {
  if (!model) {
    return getFallbackSchedule(tasks, events);
  }

  try {
    const prompt = `You are the Scheduler Agent in a scheduling assistant called Nudge.
Your job: Find gaps in the user's calendar and slot tasks into available time blocks.

Current time: ${new Date().toISOString()}
Tasks to schedule: ${JSON.stringify(tasks.filter(t => t.status !== 'done'))}
Existing calendar events: ${JSON.stringify(events)}

Rules:
- Don't schedule during existing events
- Schedule high-priority tasks in morning focus hours (9-12)
- Leave 15-min gaps between blocks
- Consider task effort level (high=2hr, medium=1hr, low=30min)

Output a JSON object with:
1. "schedule": array of {taskId, title, start (ISO), end (ISO), slot_reason}
2. "reasoning": conversational explanation of your scheduling logic

Output valid JSON only.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return getFallbackSchedule(tasks, events);
  } catch (error) {
    console.error('Scheduler Agent error:', error);
    return getFallbackSchedule(tasks, events);
  }
}

function getFallbackSchedule(tasks, events) {
  const pendingTasks = tasks.filter(t => t.status !== 'done');
  const effortDuration = { high: 120, medium: 60, low: 30 };
  
  // Find gaps in calendar
  const sortedEvents = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
  const now = new Date();
  const today = new Date(now);
  
  // Start scheduling from next available hour
  let nextSlot = new Date(today);
  nextSlot.setHours(Math.max(now.getHours() + 1, 9), 0, 0, 0);

  const schedule = pendingTasks.map(task => {
    const duration = effortDuration[task.effort] || 60;
    
    // Find next available slot that doesn't conflict
    let slotStart = new Date(nextSlot);
    let slotEnd = new Date(slotStart.getTime() + duration * 60000);
    
    // Check for conflicts and shift if needed
    for (const event of sortedEvents) {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      if (slotStart < eventEnd && slotEnd > eventStart) {
        // Conflict — move to after this event + 15 min buffer
        slotStart = new Date(eventEnd.getTime() + 15 * 60000);
        slotEnd = new Date(slotStart.getTime() + duration * 60000);
      }
    }

    // Don't schedule past 10 PM
    if (slotStart.getHours() >= 22) {
      slotStart.setDate(slotStart.getDate() + 1);
      slotStart.setHours(9, 0, 0, 0);
      slotEnd = new Date(slotStart.getTime() + duration * 60000);
    }

    // Update next slot
    nextSlot = new Date(slotEnd.getTime() + 15 * 60000);

    return {
      taskId: task.id,
      title: task.title,
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      slot_reason: `${duration}-min block in the next available gap`,
    };
  });

  return {
    schedule,
    reasoning: `I found ${schedule.length} available slots in your calendar, avoiding conflicts with your ${events.length} existing events. Each task gets a time block based on its effort level, with 15-minute buffers between blocks.`,
  };
}

export default { scheduleTasks };
