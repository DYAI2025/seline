"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useOptionalVoiceModeContext } from "./voice-mode-context";

const AvatarCanvas = dynamic(() => import("./avatar-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-xs font-mono text-terminal-muted">
      Loading avatar...
    </div>
  ),
});

export function AvatarPanel() {
  const voiceCtx = useOptionalVoiceModeContext();
  const [error, setError] = useState<string | null>(null);

  const statusText = voiceCtx?.isSpeaking
    ? "Speaking..."
    : voiceCtx?.isListening
      ? "Listening..."
      : voiceCtx?.isTranscribing
        ? "Transcribing..."
        : voiceCtx?.isVoiceMode
          ? "Ready"
          : null;

  return (
    <div className="hidden lg:flex flex-col w-[320px] shrink-0 gap-2">
      <div className="relative flex-1 min-h-[400px] border border-terminal-border/30 bg-[#1a1a2e] rounded-lg overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center h-full text-xs font-mono text-red-400 p-4 text-center">
            {error}
          </div>
        ) : (
          <AvatarCanvas
            visemes={voiceCtx?.visemes ?? []}
            audioElement={voiceCtx?.audioElement ?? null}
            isSpeaking={voiceCtx?.isSpeaking ?? false}
            avatarMood={voiceCtx?.userEmotion?.mood}
            onError={setError}
          />
        )}
      </div>
      {(statusText || voiceCtx?.userEmotion) && (
        <div className="text-center text-xs font-mono text-terminal-muted py-1">
          {statusText}
          {voiceCtx?.userEmotion && voiceCtx.userEmotion.emotion !== "neutral" && (
            <span className="ml-2 text-terminal-amber">
              [{voiceCtx.userEmotion.emotion}]
            </span>
          )}
        </div>
      )}
    </div>
  );
}
