import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let model = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key') {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export async function resolveConflict(conflictData = {}) {
  if (!model) {
    return getFallbackResolution(conflictData);
  }

  try {
    const prompt = `You are the Conflict Resolver Agent in a scheduling assistant called Nudge.
Your job: Detect scheduling conflicts and propose 2-3 alternative arrangements.

Conflict details: ${JSON.stringify(conflictData)}
Current time: ${new Date().toISOString()}

Rules:
- Propose exactly 2-3 visual alternative arrangements
- Explain WHY each alternative works
- Be conversational and friendly in tone
- Consider task priority when deciding what to move

Output a JSON object with:
1. "suggestions": array of {label, action, detail} — each is a possible resolution
2. "reasoning": conversational explanation of the conflict and your recommended fix

Output valid JSON only.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return getFallbackResolution(conflictData);
  } catch (error) {
    console.error('Conflict Resolver error:', error);
    return getFallbackResolution(conflictData);
  }
}

function getFallbackResolution(conflictData) {
  const events = conflictData.events || [];
  const eventNames = events.map(e => e.title || 'Untitled').join(' and ');

  return {
    suggestions: [
      {
        label: `Move "${events[0]?.title || 'first event'}" to tomorrow morning`,
        action: 'reschedule_first',
        detail: 'This frees up the afternoon for the more urgent item.',
      },
      {
        label: `Split "${events[1]?.title || 'second event'}" into two shorter sessions`,
        action: 'split_second',
        detail: 'Do 30 minutes now, 30 minutes later — still gets done without the conflict.',
      },
      {
        label: 'Keep both, I\'ll manage',
        action: 'dismiss',
        detail: 'No changes needed — you know your limits best.',
      },
    ],
    reasoning: `${eventNames} overlap by ${conflictData.overlapMinutes || 'some'} minutes. My top recommendation is to move the less urgent one to tomorrow morning — that gives you a clean block for the priority item. But you know best, so I've got a "keep both" option too 😊`,
  };
}

export default { resolveConflict };
