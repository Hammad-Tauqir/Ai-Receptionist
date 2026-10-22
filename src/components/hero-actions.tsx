"use client";
import { ArrowRight, Mic, MessageSquare } from "lucide-react";
export function HeroActions() {
  function focus() { window.dispatchEvent(new Event("nova:focus")); }
  return <div className="hero-actions"><button className="button button-primary" onClick={focus}><Mic size={17} />Talk to Receptionist<ArrowRight size={17} /></button><button className="button button-secondary" onClick={focus}><MessageSquare size={16} />Type a message</button></div>;
}
