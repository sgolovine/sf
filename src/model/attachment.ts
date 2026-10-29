export const ATTACHMENT_COUNT_LIMIT = 100;
export const ATTACHMENT_LIMIT = 20 * 1024 * 1024;
export const ATTACHMENT_BATCH_LIMIT = 40 * 1024 * 1024;
export type Attachment = { id: string; name: string; mediaType: string; size: number };
export type AttachmentInput = { name: string; mediaType?: string; data: string };
export type AttachmentSubmission = { attachments?: AttachmentInput[]; submissionId?: string };
