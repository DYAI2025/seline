"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import type { VisemeCue } from "./viseme-types";

interface VoiceModeState {
  isVoiceMode: boolean;
  isListening: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  visemes: VisemeCue[];
  audioElement: HTMLAudioElement | null;
}

interface VoiceModeContextValue extends VoiceModeState {
  setVoiceState: (update: Partial<VoiceModeState>) => void;
  setVisemes: (visemes: VisemeCue[]) => void;
  setAudioElement: (el: HTMLAudioElement | null) => void;
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

  return (
    <VoiceModeContext.Provider
      value={{ ...state, setVoiceState, setVisemes, setAudioElement }}
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
