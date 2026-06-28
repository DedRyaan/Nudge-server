import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

// In-memory store (in production, this is Firestore)
const tasksStore = new Map();

// GET /api/tasks — list all tasks for user
router.get('/', (req, res) => {
  const tasks = Array.from(tasksStore.values());
  res.json({ tasks });
});

// POST /api/tasks — create a new task
router.post('/', (req, res) => {
  try {
    const { title, description, scheduled_time, deadline, priority, type, source } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const task = {
      id: randomUUID(),
      title,
      description: description || '',
      status: 'pending',
      priority: priority || 'medium',
      urgency: 'comfortable',
      effort: 'medium',
      type: type || 'task',
      source: source || 'app',
      scheduled_time: scheduled_time || null,
      deadline: deadline || null,
      last_updated_by: 'app',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    tasksStore.set(task.id, task);
    res.status(201).json({ task });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id — update a task
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const task = tasksStore.get(id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updated = {
      ...task,
      ...req.body,
      id, // prevent id override
      updated_at: new Date().toISOString(),
      last_updated_by: req.body.last_updated_by || 'app',
    };

    tasksStore.set(id, updated);
    res.json({ task: updated });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id — delete a task
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  if (!tasksStore.has(id)) {
    return res.status(404).json({ error: 'Task not found' });
  }

  tasksStore.delete(id);
  res.json({ success: true });
});

export default router;
