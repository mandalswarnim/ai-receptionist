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
  confirmed: boolean;
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

export interface CallRecord {
  id: string;
  callSid: string;
  from: string;
  to: string;
  status: string;
  startedAt: Date;
  endedAt?: Date;
  duration?: number;
  recordingUrl?: string;
  callerName?: string;
  callerCompany?: string;
  callerPhone?: string;
  callerEmail?: string;
  message?: string;
  urgency?: string;
  summary?: string;
  transcript?: string;
  emailSent: boolean;
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

export interface TwilioDialStatusPayload extends TwilioCallPayload {
  DialCallStatus: 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled';
  DialCallSid?: string;
  DialCallDuration?: string;
}

export interface TwilioRecordingPayload {
  CallSid: string;
  RecordingSid: string;
  RecordingUrl: string;
  RecordingDuration: string;
  RecordingStatus: string;
}
