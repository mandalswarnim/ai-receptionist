export type UrgencyLevel = 'low' | 'medium' | 'high' | 'urgent';

export interface CallerInfo {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  message?: string;
  urgency?: UrgencyLevel;
  summary?: string;
}

export type ConversationStep =
  | 'greeting'
  | 'collect_name'
  | 'collect_company'
  | 'collect_phone'
  | 'collect_email'
  | 'collect_message'
  | 'collect_urgency'
  | 'confirm'
  | 'closing';

export interface ConversationState {
  callSid: string;
  from: string;
  step: ConversationStep;
  collectedInfo: CallerInfo;
  turnCount: number;
  turns: Array<{ role: 'assistant' | 'caller'; content: string }>;
  startedAt: Date;
  /** Consecutive turns where the caller said nothing (webhook mode). */
  silentPrompts: number;
}

export interface ExtractedCallData {
  name: string;
  company: string;
  phone: string;
  email: string;
  message: string;
  urgency: UrgencyLevel;
  summary: string;
}

// Twilio webhook payloads
export interface TwilioCallPayload {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
  AccountSid: string;
}

export interface TwilioGatherPayload extends TwilioCallPayload {
  SpeechResult?: string;
  Confidence?: string;
}

export interface TwilioRecordingPayload {
  CallSid: string;
  RecordingSid: string;
  RecordingUrl: string;
  RecordingDuration: string;
  RecordingStatus: string;
}
