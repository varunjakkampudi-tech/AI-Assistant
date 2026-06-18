"""
ElevenLabs Voice Integration for Nova AI Assistant
Provides text-to-speech with user's cloned voice.
"""
import os
import io
import base64
import httpx
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1"


class ElevenLabsVoice:
    """ElevenLabs voice synthesis client."""
    
    def __init__(self, api_key: str, voice_id: str):
        self.api_key = api_key
        self.voice_id = voice_id
        self.enabled = bool(api_key and voice_id)
        
    async def text_to_speech(
        self,
        text: str,
        model_id: str = "eleven_multilingual_v2",
        stability: float = 0.5,
        similarity_boost: float = 0.75,
        style: float = 0.0,
        use_speaker_boost: bool = True,
    ) -> Optional[bytes]:
        """
        Convert text to speech using the cloned voice.
        Returns audio bytes (MP3 format).
        """
        if not self.enabled:
            logger.warning("ElevenLabs not configured")
            return None
            
        if not text.strip():
            return None
            
        try:
            url = f"{ELEVENLABS_API_URL}/text-to-speech/{self.voice_id}"
            
            headers = {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": self.api_key,
            }
            
            payload = {
                "text": text[:5000],  # ElevenLabs limit
                "model_id": model_id,
                "voice_settings": {
                    "stability": stability,
                    "similarity_boost": similarity_boost,
                    "style": style,
                    "use_speaker_boost": use_speaker_boost,
                }
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                
                if response.status_code == 200:
                    return response.content
                else:
                    logger.error(f"ElevenLabs TTS failed: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.exception(f"ElevenLabs TTS error: {e}")
            return None
    
    async def text_to_speech_base64(self, text: str, **kwargs) -> Optional[str]:
        """Convert text to speech and return as base64 encoded string."""
        audio_bytes = await self.text_to_speech(text, **kwargs)
        if audio_bytes:
            return base64.b64encode(audio_bytes).decode("utf-8")
        return None
    
    async def get_voice_info(self) -> Optional[Dict[str, Any]]:
        """Get information about the configured voice."""
        if not self.enabled:
            return None
            
        try:
            url = f"{ELEVENLABS_API_URL}/voices/{self.voice_id}"
            headers = {"xi-api-key": self.api_key}
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                
                if response.status_code == 200:
                    return response.json()
                return None
        except Exception as e:
            logger.exception(f"Failed to get voice info: {e}")
            return None
    
    async def list_voices(self) -> list:
        """List all available voices."""
        try:
            url = f"{ELEVENLABS_API_URL}/voices"
            headers = {"xi-api-key": self.api_key}
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    return data.get("voices", [])
                return []
        except Exception as e:
            logger.exception(f"Failed to list voices: {e}")
            return []
    
    async def get_subscription_info(self) -> Optional[Dict[str, Any]]:
        """Get subscription/usage information."""
        try:
            url = f"{ELEVENLABS_API_URL}/user/subscription"
            headers = {"xi-api-key": self.api_key}
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                
                if response.status_code == 200:
                    return response.json()
                return None
        except Exception as e:
            logger.exception(f"Failed to get subscription info: {e}")
            return None


# Singleton instance (initialized in server.py)
elevenlabs_voice: Optional[ElevenLabsVoice] = None


def init_elevenlabs(api_key: str, voice_id: str) -> ElevenLabsVoice:
    """Initialize ElevenLabs voice client."""
    global elevenlabs_voice
    elevenlabs_voice = ElevenLabsVoice(api_key, voice_id)
    logger.info(f"ElevenLabs initialized with voice_id: {voice_id[:8]}...")
    return elevenlabs_voice


def get_elevenlabs() -> Optional[ElevenLabsVoice]:
    """Get the ElevenLabs voice client instance."""
    return elevenlabs_voice
