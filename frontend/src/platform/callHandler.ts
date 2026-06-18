/**
 * Cross-Platform Call & Notification Handler
 * Works on both iOS and Android with Expo
 * 
 * Note: Some features require native modules for full functionality:
 * - iOS: CallKit for call handling
 * - Android: ConnectionService for call handling
 * - Both: Native modules for reading other apps' notifications
 * 
 * This module provides a unified API that:
 * 1. Works in Expo Go with simulated/mock data
 * 2. Can be extended with native modules for production builds
 */

import { Platform, Linking, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Contacts from 'expo-contacts';
import { api } from '../api';

// ==================== TYPES ====================

export interface IncomingCall {
  id: string;
  phoneNumber: string;
  contactName?: string;
  status: 'ringing' | 'answered' | 'missed' | 'ended';
  startedAt: string;
  isAiAnswered?: boolean;
}

export interface CallHandler {
  onIncomingCall?: (call: IncomingCall) => void;
  onCallEnded?: (call: IncomingCall) => void;
  onMissedCall?: (call: IncomingCall) => void;
}

// ==================== CROSS-PLATFORM CALL MANAGER ====================

class CrossPlatformCallManager {
  private handlers: CallHandler = {};
  private activeCall: IncomingCall | null = null;

  constructor() {
    // Listen for app state changes to detect when user returns from a call
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = async (state: AppStateStatus) => {
    // When app becomes active after being in background, check for missed calls
    if (state === 'active' && this.activeCall?.status === 'ringing') {
      // Call might have been missed while app was in background
      // In production, native module would provide accurate status
    }
  };

  /**
   * Register event handlers
   */
  setHandlers(handlers: CallHandler) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Simulate an incoming call (for testing in Expo Go)
   * In production, this would be triggered by native CallKit/ConnectionService
   */
  async simulateIncomingCall(phoneNumber: string, contactName?: string): Promise<IncomingCall> {
    // Look up contact name if not provided
    let name = contactName;
    if (!name) {
      name = await this.lookupContact(phoneNumber);
    }

    // Register with backend
    const response = await api.registerIncomingCall(phoneNumber, name);
    
    const call: IncomingCall = {
      id: response.id,
      phoneNumber: response.phone_number,
      contactName: response.contact_name,
      status: 'ringing',
      startedAt: response.started_at,
    };

    this.activeCall = call;
    this.handlers.onIncomingCall?.(call);

    // Show local notification
    await this.showCallNotification(call);

    return call;
  }

  /**
   * Answer the call with AI using user's cloned voice
   */
  async answerWithAI(callId: string): Promise<{ greeting: string; audioBase64?: string }> {
    const response = await api.answerCall(callId, true);
    
    if (this.activeCall && this.activeCall.id === callId) {
      this.activeCall.status = 'answered';
      this.activeCall.isAiAnswered = true;
    }

    return {
      greeting: response.greeting_text || "Hello, this is Nova speaking.",
      audioBase64: response.greeting_audio_base64,
    };
  }

  /**
   * Answer call normally (user picks up themselves)
   */
  async answerNormally(callId: string): Promise<void> {
    await api.answerCall(callId, false);
    
    if (this.activeCall && this.activeCall.id === callId) {
      this.activeCall.status = 'answered';
    }

    // Open phone app
    this.openPhoneApp(this.activeCall?.phoneNumber);
  }

  /**
   * Mark call as missed
   */
  async markMissed(callId: string): Promise<void> {
    const response = await api.markCallMissed(callId);
    
    if (this.activeCall && this.activeCall.id === callId) {
      this.activeCall.status = 'missed';
      this.handlers.onMissedCall?.(this.activeCall);
      this.activeCall = null;
    }

    // Show missed call notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📞 Missed Call',
        body: `You missed a call from ${response.call?.contact_name || response.call?.phone_number}`,
        data: { type: 'missed_call', callId },
      },
      trigger: null, // Immediate
    });
  }

  /**
   * End the call
   */
  async endCall(callId: string, summary?: string): Promise<void> {
    await api.endIncomingCall(callId, summary);
    
    if (this.activeCall && this.activeCall.id === callId) {
      this.activeCall.status = 'ended';
      this.handlers.onCallEnded?.(this.activeCall);
      this.activeCall = null;
    }
  }

  /**
   * Get the currently active call
   */
  getActiveCall(): IncomingCall | null {
    return this.activeCall;
  }

  /**
   * Look up contact name from phone number
   */
  async lookupContact(phoneNumber: string): Promise<string | undefined> {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') return undefined;

      // Normalize phone number for comparison
      const normalized = phoneNumber.replace(/\D/g, '').slice(-10);

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      for (const contact of data) {
        for (const phone of contact.phoneNumbers || []) {
          const contactNormalized = (phone.number || '').replace(/\D/g, '').slice(-10);
          if (contactNormalized === normalized) {
            return contact.name;
          }
        }
      }
    } catch (e) {
      console.warn('Contact lookup failed:', e);
    }
    return undefined;
  }

  /**
   * Open phone app to call a number
   */
  openPhoneApp(phoneNumber?: string): void {
    if (phoneNumber) {
      Linking.openURL(`tel:${phoneNumber}`);
    }
  }

  /**
   * Show incoming call notification
   */
  private async showCallNotification(call: IncomingCall): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📞 Incoming Call',
        body: call.contactName || call.phoneNumber,
        data: { type: 'incoming_call', callId: call.id },
        categoryIdentifier: 'incoming_call',
      },
      trigger: null,
    });
  }

  /**
   * Clean up
   */
  destroy(): void {
    // Cleanup if needed
  }
}

// ==================== NOTIFICATION SETUP ====================

export async function setupNotifications(): Promise<void> {
  // Request permissions
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn('Notification permissions not granted');
    return;
  }

  // Configure notification behavior
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  // Set up notification categories for call actions (iOS)
  if (Platform.OS === 'ios') {
    await Notifications.setNotificationCategoryAsync('incoming_call', [
      {
        identifier: 'answer_ai',
        buttonTitle: '🤖 Nova Answer',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'answer_normal',
        buttonTitle: '📞 Answer',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'decline',
        buttonTitle: 'Decline',
        options: { isDestructive: true },
      },
    ]);
  }
}

/**
 * Handle notification response (when user taps notification action)
 */
export function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  callManager: CrossPlatformCallManager
): void {
  const data = response.notification.request.content.data;
  const actionId = response.actionIdentifier;

  if (data?.type === 'incoming_call' && data?.callId) {
    switch (actionId) {
      case 'answer_ai':
        callManager.answerWithAI(data.callId as string);
        break;
      case 'answer_normal':
        callManager.answerNormally(data.callId as string);
        break;
      case 'decline':
        callManager.markMissed(data.callId as string);
        break;
    }
  }
}

// ==================== VOICE SYNTHESIS (ElevenLabs) ====================

export class VoiceSynthesis {
  /**
   * Generate speech audio from text using ElevenLabs cloned voice
   * Returns base64 audio that can be played with expo-audio
   */
  async generateSpeech(text: string): Promise<string | null> {
    try {
      const response = await api.textToSpeech(text);
      return response.audio_base64 || null;
    } catch (e) {
      console.error('TTS failed:', e);
      return null;
    }
  }

  /**
   * Check if ElevenLabs is configured
   */
  async isAvailable(): Promise<boolean> {
    try {
      const status = await api.voiceStatus();
      return status.enabled === true;
    } catch {
      return false;
    }
  }
}

// ==================== EXPORTS ====================

export const callManager = new CrossPlatformCallManager();
export const voiceSynthesis = new VoiceSynthesis();

export default {
  callManager,
  voiceSynthesis,
  setupNotifications,
  handleNotificationResponse,
};
