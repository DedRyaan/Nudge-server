// Communication Agent — drafts WhatsApp nudges and extension-request emails
// These are surfaced for one-tap approval, never auto-sent

export async function draftNudge(task, context = {}) {
  const templates = {
    upcoming: `Hey! Just a heads up — "${task.title}" is coming up ${context.timeLeft || 'soon'}. You've got this! 💪`,
    overdue: `Quick reminder: "${task.title}" was due ${context.timeAgo || 'recently'}. Want to snooze it or mark it done?`,
    encouragement: `Nice progress today! ${context.completedCount || 'Several'} tasks down. Keep it going 🎉`,
    daily_digest: `Good morning! Here's your day:\n${context.tasks?.map(t => `• ${t.title}`).join('\n') || 'No tasks yet.'}\n\nReply "plan" to see AI suggestions.`,
  };

  const type = context.type || 'upcoming';
  
  return {
    message: templates[type] || templates.upcoming,
    type,
    requiresApproval: true,
    draft: true,
  };
}

export async function draftExtensionEmail(task, context = {}) {
  return {
    subject: `Request for Extension — ${task.title}`,
    body: `Hi ${context.recipientName || 'Professor'},\n\nI hope this message finds you well. I'm writing to request a brief extension on "${task.title}"${context.originalDeadline ? `, originally due ${context.originalDeadline}` : ''}.\n\n${context.reason || 'Due to overlapping commitments, I need a bit more time to deliver quality work.'}\n\nWould it be possible to extend the deadline by ${context.extensionDays || 2} days? I'm happy to discuss this further.\n\nThank you for your understanding.\n\nBest regards`,
    requiresApproval: true,
    draft: true,
  };
}

export default { draftNudge, draftExtensionEmail };
