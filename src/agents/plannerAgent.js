import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let model = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key') {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export async function planTasks(tasks = [], events = []) {
  if (!model) {
    return getFallbackPlan(tasks, events);
  }

  try {
    const prompt = `You are the Planner Agent in a scheduling assistant called Nudge.
Your job: Rank tasks by urgency × importance × effort to produce a prioritized plan.

Current time: ${new Date().toISOString()}
Tasks: ${JSON.stringify(tasks)}
Calendar events: ${JSON.stringify(events)}

Output a JSON object with:
1. "plan": array of task objects sorted by priority, each with added "rank" (1-N) and "reason" fields
2. "reasoning": a short, conversational explanation of your ranking logic

Be conversational in the reasoning — like a friend explaining their thinking.
Output valid JSON only.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return getFallbackPlan(tasks, events);
  } catch (error) {
    console.error('Planner Agent error:', error);
    return getFallbackPlan(tasks, events);
  }
}

function getFallbackPlan(tasks, events) {
  // Simple priority-based ranking
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  
  const ranked = [...tasks]
    .filter(t => t.status !== 'done')
    .sort((a, b) => {
      const aScore = (priorityWeight[a.priority] || 2) * (a.deadline ? getUrgencyScore(a.deadline) : 1);
      const bScore = (priorityWeight[b.priority] || 2) * (b.deadline ? getUrgencyScore(b.deadline) : 1);
      return bScore - aScore;
    })
    .map((task, idx) => ({
      ...task,
      rank: idx + 1,
      reason: getRankReason(task, idx),
    }));

  return {
    plan: ranked,
    reasoning: `I ranked your ${ranked.length} pending tasks by combining priority level and deadline urgency. ${ranked[0] ? `"${ranked[0].title}" is #1 because it's ${ranked[0].priority} priority${ranked[0].deadline ? ' with an approaching deadline' : ''}.` : 'No pending tasks to rank.'}`,
  };
}

function getUrgencyScore(deadline) {
  const hoursLeft = (new Date(deadline) - new Date()) / (1000 * 60 * 60);
  if (hoursLeft < 0) return 5; // overdue
  if (hoursLeft < 2) return 4; // critical
  if (hoursLeft < 6) return 3; // urgent
  if (hoursLeft < 24) return 2; // soon
  return 1; // comfortable
}

function getRankReason(task, idx) {
  if (task.priority === 'high' && task.deadline) {
    const hoursLeft = (new Date(task.deadline) - new Date()) / (1000 * 60 * 60);
    if (hoursLeft < 2) return 'Critical — due very soon!';
    if (hoursLeft < 6) return 'High priority with approaching deadline';
    return 'High priority task';
  }
  if (task.priority === 'high') return 'High priority — tackle this early';
  if (task.priority === 'medium') return 'Medium priority — important but not urgent';
  return 'Lower priority — can wait if needed';
}

export default { planTasks };
