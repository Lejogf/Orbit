'use client';

// Voice input through the browser's own speech recognition (Chrome, Edge and
// Safari). Nothing is sent to us that the customer didn't see typed out.
import { useCallback, useEffect, useRef, useState } from 'react';

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput(lang: 'en' | 'es', onHeard: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<RecognitionLike | null>(null);
  const handler = useRef(onHeard);
  handler.current = onHeard;

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = lang === 'es' ? 'es-US' : 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? '';
      if (text.trim()) handler.current(text);
    };
    r.onerror = (event) => {
      setError(
        event.error === 'not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser settings, or type instead.'
          : event.error === 'no-speech'
            ? "I didn't hear anything. Tap the microphone and try speaking again."
            : 'Voice input stopped. You can type instead.',
      );
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }, [lang]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, error, start, stop };
}
