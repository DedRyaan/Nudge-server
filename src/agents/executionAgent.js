// Execution Agent — creates events, splits tasks, reflects changes
// across both app and WhatsApp via Firestore

export async function createCalendarEvent(eventData, calendarService) {
  // In production, this uses the Google Calendar API
  return {
    success: true,
    event: {
      id: `created-${Date.now()}`,
      title: eventData.title,
      start: eventData.start,
      end: eventData.end,
      source: 'ai',
    },
    action: 'Created calendar event',
  };
}

export async function splitTaskIntoChecklist(task) {
  // Break a complex task into smaller sub-tasks
  const subtasks = [];
  
  // Simple heuristic splitting based on task type
  if (task.type === 'academic') {
    subtasks.push(
      { title: `Research & gather materials for ${task.title}`, effort: 'medium', duration: 30 },
      { title: `Draft main content for ${task.title}`, effort: 'high', duration: 60 },
      { title: `Review & finalize ${task.title}`, effort: 'low', duration: 20 },
    );
  } else if (task.type === 'work') {
    subtasks.push(
      { title: `Prepare for ${task.title}`, effort: 'low', duration: 15 },
      { title: `Execute ${task.title}`, effort: 'high', duration: 45 },
      { title: `Follow up on ${task.title}`, effort: 'low', duration: 10 },
    );
  } else {
    subtasks.push(
      { title: `Start ${task.title}`, effort: 'medium', duration: 30 },
      { title: `Complete ${task.title}`, effort: 'medium', duration: 30 },
    );
  }

  return {
    originalTask: task,
    subtasks,
    reasoning: `Split "${task.title}" into ${subtasks.length} smaller steps to make it more manageable.`,
  };
}

export async function syncToWhatsApp(change, whatsappService) {
  // Only sync significant changes
  const significantChanges = ['status', 'scheduled_time', 'deadline'];
  const isSignificant = Object.keys(change.updates || {}).some(
    key => significantChanges.includes(key)
  );

  if (!isSignificant) {
    return { synced: false, reason: 'Change not significant enough for WhatsApp notification' };
  }

  // Draft the WhatsApp message
  let message = '';
  if (change.updates.status === 'done') {
    message = `✅ "${change.taskTitle}" marked as done. Nice work!`;
  } else if (change.updates.scheduled_time) {
    message = `📅 Moved "${change.taskTitle}" to ${new Date(change.updates.scheduled_time).toLocaleString()}`;
  } else if (change.updates.deadline) {
    message = `⏰ Deadline for "${change.taskTitle}" updated to ${new Date(change.updates.deadline).toLocaleString()}`;
  }

  return {
    synced: true,
    message,
    requiresApproval: false, // Status syncs are automatic
  };
}

export default { createCalendarEvent, splitTaskIntoChecklist, syncToWhatsApp };
