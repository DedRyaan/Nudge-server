import { Router } from 'express';
import { planTasks } from '../agents/plannerAgent.js';
import { scheduleTasks } from '../agents/schedulerAgent.js';
import { resolveConflict } from '../agents/conflictResolver.js';
import { chatWithNudge } from '../agents/orchestrator.js';

const router = Router();

// In-memory thinking log
const thinkingLog = [];

function addToLog(entry) {
  thinkingLog.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 50 entries
  if (thinkingLog.length > 50) {
    thinkingLog.shift();
  }
}

// POST /api/agents/plan — run Planner Agent
router.post('/plan', async (req, res) => {
  try {
    const { tasks, events } = req.body;
    const result = await planTasks(tasks, events);
    
    addToLog({
      agent: 'Planner',
      action: 'Ranked tasks by urgency × importance × effort',
      detail: result.reasoning,
    });

    res.json({ 
      plan: result.plan,
      reasoning: result.reasoning,
    });
  } catch (error) {
    console.error('Planner error:', error);
    res.status(500).json({ error: 'Planning failed' });
  }
});

// POST /api/agents/schedule — run Scheduler Agent
router.post('/schedule', async (req, res) => {
  try {
    const { tasks, events } = req.body;
    const result = await scheduleTasks(tasks, events);
    
    addToLog({
      agent: 'Scheduler',
      action: 'Found gaps and scheduled task blocks',
      detail: result.reasoning,
    });

    res.json({ 
      schedule: result.schedule,
      reasoning: result.reasoning,
    });
  } catch (error) {
    console.error('Scheduler error:', error);
    res.status(500).json({ error: 'Scheduling failed' });
  }
});

// POST /api/agents/resolve-conflict — run Conflict Resolver
router.post('/resolve-conflict', async (req, res) => {
  try {
    const { conflictData } = req.body;
    const result = await resolveConflict(conflictData);
    
    addToLog({
      agent: 'Conflict Resolver',
      action: 'Analyzed scheduling conflict',
      detail: result.reasoning,
    });

    res.json({ 
      suggestions: result.suggestions,
      reasoning: result.reasoning,
    });
  } catch (error) {
    console.error('Conflict resolver error:', error);
    res.status(500).json({ error: 'Conflict resolution failed' });
  }
});

// POST /api/agents/chat — Assistant chat with Nudge
router.post('/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    const result = await chatWithNudge(message, context);
    
    if (result.agentActions?.length) {
      result.agentActions.forEach(action => addToLog(action));
    }

    res.json({ 
      reply: result.reply,
      agentActions: result.agentActions,
      clientActions: result.clientActions,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// GET /api/agents/thinking-log — get agent reasoning history
router.get('/thinking-log', (req, res) => {
  res.json({ log: thinkingLog });
});

export default router;
