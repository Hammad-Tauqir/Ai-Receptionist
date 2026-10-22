"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };

export function useBrowserVoice(onTranscript: (text: string) => void) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [playbackSupported, setPlaybackSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("en-PK");
  const [readAloud, setReadAloudState] = useState(false);
  const readAloudRef = useRef(false);
  const recognition = useRef<Recognition | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    setPlaybackSupported("speechSynthesis" in window);
    return () => {
      if (recognition.current) {
        recognition.current.onend = null;
        recognition.current.onresult = null;
        recognition.current.onerror = null;
        recognition.current.abort();
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    if (utterance.current) { utterance.current.onend = null; utterance.current.onerror = null; }
    window.speechSynthesis?.cancel();
    utterance.current = null;
    setSpeaking(false);
  }, []);

  function setReadAloud(enabled: boolean) {
    readAloudRef.current = enabled;
    setReadAloudState(enabled);
    if (!enabled) stopSpeaking();
  }

  function speak(text: string) {
    if (!readAloudRef.current || !("speechSynthesis" in window)) return;
    stopSpeaking();
    // Strip common Markdown syntax from playback while preserving the visible reply.
    const speech = new SpeechSynthesisUtterance(text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*#`_]/g, ""));
    const desiredLanguage = /[\u0600-\u06ff]/.test(text) ? "ur-PK" : "en-PK";
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.toLowerCase() === desiredLanguage.toLowerCase()) ?? voices.find(v => v.lang.toLowerCase().startsWith(desiredLanguage.slice(0, 2)));
    if (match) speech.voice = match;
    speech.lang = match?.lang ?? desiredLanguage;
    speech.rate = 0.96;
    speech.onend = () => { setSpeaking(false); utterance.current = null; };
    speech.onerror = event => {
      setSpeaking(false);
      if (event.error !== "canceled" && event.error !== "interrupted") setError("Read-aloud is unavailable for this reply. You can still read the message below.");
    };
    utterance.current = speech;
    setSpeaking(true);
    window.speechSynthesis.speak(speech);
  }

  function startListening() {
    if (recognition.current) return;
    stopSpeaking();
    setError("");
    setInterim("");
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Constructor) { setSupported(false); return; }
    const instance = new Constructor();
    instance.lang = language;
    instance.continuous = false;
    instance.interimResults = true;
    let finalText = "";
    let failed = false;
    instance.onresult = event => {
      let finalized = "";
      let partial = "";
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) finalized += `${result[0].transcript} `;
        else partial += result[0].transcript;
      }
      finalText = finalized.trim();
      setInterim([finalText, partial].filter(Boolean).join(" "));
    };
    instance.onerror = event => {
      failed = true;
      const errors: Record<string, string> = {
        "not-allowed": "Microphone permission was denied. Allow microphone access in your browser, or type your message.",
        "service-not-allowed": "Speech recognition is unavailable in this browser. Please type your message.",
        "no-speech": "No speech was detected. Try the microphone again or type your message.",
        "audio-capture": "No microphone was found. Connect a microphone or type your message.",
        "network": "The browser’s speech service could not be reached. Please type your message.",
        "language-not-supported": "This recognition language is not available on your device. Choose another language or type your message.",
      };
      setError(errors[event.error] ?? "Speech recognition stopped. Try again or type your message.");
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
      setInterim("");
      if (finalText && !failed) onTranscriptRef.current(finalText);
      else if (!failed) setError("No final transcript was received. Try again or type your message.");
    };
    recognition.current = instance;
    setListening(true);
    try { instance.start(); }
    catch { recognition.current = null; setListening(false); setError("The microphone could not start. Please type your message."); }
  }
  function stopListening() { recognition.current?.stop(); }
  function reset() {
    const instance = recognition.current;
    if (instance) { instance.onend = null; instance.onerror = null; instance.onresult = null; instance.abort(); }
    recognition.current = null;
    setListening(false); setInterim(""); setError(""); stopSpeaking();
  }
  return { supported, playbackSupported, listening, speaking, interim, error, clearError: () => setError(""), language, setLanguage, readAloud, setReadAloud, startListening, stopListening, speak, stopSpeaking, reset };
}
