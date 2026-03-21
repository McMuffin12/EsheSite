import type { APIRoute } from 'astro';
import { Resend } from 'resend';

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const TO_EMAIL = import.meta.env.RESEND_TO;
const FROM_EMAIL = import.meta.env.RESEND_FROM;

// This route must be server-rendered to access request headers and form data
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Debug: log request headers to check Content-Type
  const contentType = request.headers.get('content-type') || '';
  console.log('Contact API Content-Type:', contentType);
  
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error('FormData parsing error:', err);
    return new Response(JSON.stringify({ error: 'Invalid form data format' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  
  const type = formData.get('type');
  const email = formData.get('email');
  const message = formData.get('message');
  const attachment = formData.get('attachment');

  // Dynamic fields
  const projectDetails = formData.get('projectDetails');
  const budget = formData.get('budget');
  const question = formData.get('question');
  const feedbackType = formData.get('feedbackType');

  // Validate file
  let fileInfo = '';
  let fileAttachment = null;
  if (attachment && typeof attachment === 'object' && 'size' in attachment) {
    if (attachment.size > 0) {
      if (attachment.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File too large (max 5MB)' }), { status: 400 });
      }
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowedTypes.includes(attachment.type)) {
        return new Response(JSON.stringify({ error: 'Invalid file type' }), { status: 400 });
      }
      const arrayBuffer = await attachment.arrayBuffer();
      fileAttachment = {
        filename: attachment.name,
        content: Buffer.from(arrayBuffer),
      };
      fileInfo = `\nFile: ${attachment.name} (${attachment.size} bytes)`;
    }
  }

  // Compose email body
  let subject = 'New Contact Submission';
  let html = `
    <h2 style="color: #324e3d;">Contact Form Submission</h2>
    <p><strong>Type:</strong> ${type}</p>
    <p><strong>Email:</strong> ${email}</p>
  `;
  
  if (type === 'commission') {
    html += `
      <p><strong>Project Details:</strong></p>
      <p>${projectDetails || 'No details provided'}</p>
      <p><strong>Budget:</strong> ${budget || 'Not specified'}</p>
    `;
    subject = 'New Commission Request';
  } else if (type === 'qa') {
    html += `
      <p><strong>Question:</strong></p>
      <p>${question || 'No question provided'}</p>
    `;
    subject = 'New Q&A Submission';
  } else if (type === 'feedback') {
    html += `
      <p><strong>Feedback Type:</strong> ${feedbackType}</p>
      <p><strong>Message:</strong></p>
      <p>${message || 'No message provided'}</p>
    `;
    subject = 'New Feedback Submission';
  }
  
  if (fileInfo) {
    html += `<p style="margin-top: 20px; font-size: 0.9em; color: #666;"><strong>Attachment:</strong>${fileInfo}</p>`;
  }
  
  html += `<hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;"><p style="font-size: 0.85em; color: #999;">This email was sent from the contact form on Life's Little Things</p>`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject,
      html,
      attachments: fileAttachment ? [fileAttachment] : undefined,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to send email.' }), { status: 500 });
  }
};
