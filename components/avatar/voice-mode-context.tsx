"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { VisemeCue } from "./viseme-types";

export interface EmotionState {
  emotion: string;
  mood: string;
  expression: string;
  ttsInstruct: string;
}

interface VoiceModeState {
  isVoiceMode: boolean;
  isListening: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  visemes: VisemeCue[];
  audioElement: HTMLAudioElement | null;
  userEmotion: EmotionState | null;
}

interface VoiceModeContextValue extends VoiceModeState {
  setVoiceState: (update: Partial<VoiceModeState>) => void;
  setVisemes: (visemes: VisemeCue[]) => void;
  setAudioElement: (el: HTMLAudioElement | null) => void;
  setUserEmotion: (emotion: EmotionState | null) => void;
}

const VoiceModeContext = createContext<VoiceModeContextValue | null>(null);

export function VoiceModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VoiceModeState>({
    isVoiceMode: false,
    isListening: false,
    isTranscribing: false,
    isSpeaking: false,
    visemes: [],
    audioElement: null,
    userEmotion: null,
  });

  const setVoiceState = useCallback((update: Partial<VoiceModeState>) => {
    setState((prev) => ({ ...prev, ...update }));
  }, []);

  const setVisemes = useCallback((visemes: VisemeCue[]) => {
    setState((prev) => ({ ...prev, visemes }));
  }, []);

  const setAudioElement = useCallback((el: HTMLAudioElement | null) => {
    setState((prev) => ({ ...prev, audioElement: el }));
  }, []);

  const setUserEmotion = useCallback((emotion: EmotionState | null) => {
    setState((prev) => ({ ...prev, userEmotion: emotion }));
  }, []);

  return (
    <VoiceModeContext.Provider
      value={{ ...state, setVoiceState, setVisemes, setAudioElement, setUserEmotion }}
    >
      {children}
    </VoiceModeContext.Provider>
  );
}

export function useVoiceModeContext(): VoiceModeContextValue {
  const ctx = useContext(VoiceModeContext);
  if (!ctx) {
    throw new Error("useVoiceModeContext must be used within VoiceModeProvider");
  }
  return ctx;
}

export function useOptionalVoiceModeContext(): VoiceModeContextValue | null {
  return useContext(VoiceModeContext);
}
