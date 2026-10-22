"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, AudioLines, Check, ChevronDown, Globe2, LoaderCircle, MessageSquare, Mic, Plus, ShieldCheck, Square, Volume2 } from "lucide-react";
import { MAX_MESSAGE_LENGTH, SESSION_ID_PATTERN } from "@/lib/chat-contract";
import { useBrowserVoice } from "@/hooks/use-browser-voice";
import { MessageContent } from "./message-content";

const GREETING = "Hi! I’m Nova, Nova Digital’s AI receptionist. How can I help you?";
const STARTERS = ["What services do you offer?", "I need an e-commerce website.", "I’d like to book a discovery call."];
type Message = { id: string; role: "assistant" | "visitor"; text: string; initial?: boolean };
const initialMessages: Message[] = [{ id: "greeting", role: "assistant", text: GREETING, initial: true }];
const SESSION_KEY = "nova.conversation.id";

export function Receptionist({ connected }: { connected: boolean }) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState(false);
  const [ready, setReady] = useState(false);
  const sessionId = useRef("");
  const pendingRef = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const voice = useBrowserVoice(text => {
    setDraft(current => [current.trim(), text].filter(Boolean).join(" "));
    setReviewing(true);
    input.current?.focus();
  });

  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(SESSION_KEY); } catch { setStorageNote(true); }
    sessionId.current = stored && SESSION_ID_PATTERN.test(stored) ? stored : crypto.randomUUID();
    try { sessionStorage.setItem(SESSION_KEY, sessionId.current); } catch { setStorageNote(true); }
    setReady(true);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    const element = conversation.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, pending]);

  function focusInput() {
    document.getElementById("receptionist")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    input.current?.focus({ preventScroll: true });
  }
  // Hero controls focus the composer; recording requires a separate explicit mic click.
  useEffect(() => {
    const handler = () => focusInput();
    window.addEventListener("nova:focus", handler);
    return () => window.removeEventListener("nova:focus", handler);
  }, []);

  async function send() {
    const text = draft.trim();
    if (!ready || pendingRef.current || voice.listening || !text || text.length > MAX_MESSAGE_LENGTH) return;
    voice.stopSpeaking(); voice.clearError(); setError("");
    if (!connected) {
      setError("This is a demo preview. Your message has not been sent; the receptionist is not connected. No booking or lead was created.");
      return;
    }
    pendingRef.current = true;
    setPending(true); setReviewing(false); setDraft("");
    setMessages(current => [...current, { id: crypto.randomUUID(), role: "visitor", text }]);
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 35_000);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, sessionId: sessionId.current }), signal: abort.signal });
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error();
      if (!response.ok) {
        setError("error" in data && typeof data.error === "string" ? data.error : "The action could not be confirmed. Please check before submitting again.");
        return;
      }
      if (!("reply" in data) || typeof data.reply !== "string" || !data.reply.trim()) throw new Error();
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: data.reply as string }]);
      voice.speak(data.reply);
    } catch {
      setError("The reply could not be received. Any booking or lead action could not be confirmed. Your message will not be retried automatically. Please check before submitting it again.");
    } finally {
      clearTimeout(timer); pendingRef.current = false; setPending(false); controller.current = null;
    }
  }
  function newConversation() {
    if (pendingRef.current) return;
    voice.reset();
    sessionId.current = crypto.randomUUID();
    try { sessionStorage.setItem(SESSION_KEY, sessionId.current); } catch { setStorageNote(true); }
    setMessages(initialMessages); setDraft(""); setReviewing(false); setError("");
    input.current?.focus();
  }
  const currentError = error || voice.error;
  const state = currentError ? "Error" : pending ? "Waiting for reply" : voice.listening ? "Listening" : voice.speaking ? "Speaking" : reviewing ? "Review your message" : "Ready";
  return <section id="receptionist" className="receptionist" aria-labelledby="receptionist-title">
    <header className="panel-header">
      <div className="panel-identity"><span className="nova-avatar"><AudioLines size={22} /></span><div><h2 id="receptionist-title">Nova <span>— AI Receptionist</span></h2><p><span className={`status-dot ${!connected ? "amber" : ""}`} />{connected ? "AI assistant · Ready to help" : "AI assistant · Demo preview"}</p></div></div>
      <button className="icon-button" title="New conversation" aria-label="New conversation" onClick={newConversation} disabled={pending || !ready}><Plus size={19} /></button>
    </header>
    {!connected && <div className="demo-banner"><span className="tiny-dot" />Demo preview — receptionist not connected</div>}
    <div className={`voice-stage ${voice.listening || voice.speaking ? "voice-active" : ""}`}>
      <div className="orb-scene" aria-hidden="true"><div className="orb-orbit orbit-one" /><div className="orb-orbit orbit-two" /><div className="nova-orb"><AudioLines size={34} strokeWidth={1.4} /></div><div className="orb-spark spark-one" /><div className="orb-spark spark-two" /></div>
      <div className="voice-status"><span className={`status-dot ${currentError ? "amber" : ""}`} /><span role="status">{state}</span></div>
      <p>{voice.listening ? "I’m listening. Stop when you’re done." : reviewing ? "Make any corrections, then press Send." : "Your next project starts with a conversation."}</p>
    </div>
    <div className="conversation" ref={conversation} role="log" aria-label="Conversation with Nova" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
      {messages.map(message => <div key={message.id} className={`message message-${message.role}`}>
        <div className="message-byline">{message.role === "assistant" ? <><span className="mini-mark">n</span> Nova <span className="ai-tag">AI</span>{message.initial && !connected && <span className="example-label">Example greeting</span>}</> : <>You <Check size={11} /></>}</div>
        <div className="message-bubble" dir="auto"><MessageContent text={message.text} /></div>
      </div>)}
      {pending && <div className="waiting-message"><LoaderCircle size={14} className="spin" /> Nova is working on your reply…</div>}
    </div>
    {messages.length === 1 && <div className="starters"><p>NOT SURE WHERE TO START?</p>{STARTERS.map(starter => <button key={starter} disabled={pending || voice.listening} onClick={() => { setDraft(starter); setReviewing(false); setError(""); voice.clearError(); input.current?.focus(); }}>{starter}<ArrowUpRight size={14} /></button>)}</div>}
    <div className="composer-area">
      {voice.interim && <p className="transcript-preview" dir="auto">Hearing: {voice.interim}</p>}
      {currentError && <p role="alert" className="chat-error">{currentError}</p>}
      {draft.length > MAX_MESSAGE_LENGTH && <p role="alert" className="chat-error">Please shorten your message to {MAX_MESSAGE_LENGTH.toLocaleString()} characters.</p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <div className="composer">
          <label className="sr-only" htmlFor="chat-message">Your message to Nova</label>
          <textarea id="chat-message" ref={input} rows={2} dir="auto" placeholder="Tell Nova what you have in mind…" value={draft} disabled={pending || voice.listening} onChange={event => { setDraft(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} aria-describedby="composer-help" />
          <div className="composer-bottom"><span><MessageSquare size={12} /> English or Roman Urdu</span><button className="send-button" type="submit" aria-label="Send message" disabled={!ready || pending || voice.listening || !draft.trim() || draft.trim().length > MAX_MESSAGE_LENGTH}>{pending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}</button></div>
        </div>
      </form>
      <div className="voice-controls">
        <button className={`mic-button ${voice.listening ? "listening" : ""}`} onClick={() => { setError(""); if (voice.listening) voice.stopListening(); else { setReviewing(false); voice.startListening(); } }} disabled={!ready || pending || !voice.supported} aria-label={voice.listening ? "Stop microphone" : "Start microphone"}>{voice.listening ? <Square size={14} /> : <Mic size={15} />}<span>{voice.listening ? "Stop" : "Speak"}</span></button>
        <label className="language-select"><Globe2 size={13} /><span className="sr-only">Recognition language</span><select aria-label="Recognition language" value={voice.language} disabled={voice.listening || pending} onChange={event => voice.setLanguage(event.target.value)}><option value="en-PK">English</option><option value="ur-PK">Urdu</option></select><ChevronDown size={11} /></label>
        <button className="read-aloud" role="switch" aria-checked={voice.readAloud} aria-label="Read replies aloud" disabled={!voice.playbackSupported} onClick={() => voice.setReadAloud(!voice.readAloud)}><Volume2 size={14} /><span>Read aloud</span><span className={`toggle ${voice.readAloud ? "on" : ""}`} /></button>
      </div>
      {voice.speaking && <button className="stop-speaking" onClick={voice.stopSpeaking}><Square size={11} />Stop speaking</button>}
      <p id="composer-help" className="voice-note">{voice.supported === false ? "Voice input isn’t supported in this browser. Text chat is fully available. " : "Speak, review, then send. Browser recognition may use your browser provider’s online service. "}Voice quality and language availability depend on your device.</p>
      {storageNote && <p className="voice-note">Session storage is unavailable. Your conversation ID will last until this page is reloaded.</p>}
    </div>
    <div className="panel-footer"><ShieldCheck size={12} /><span>You choose what to share. No raw audio is stored by this app.</span></div>
  </section>;
}
