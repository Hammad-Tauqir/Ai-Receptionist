import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Braces, Check, Code2, Layers3, MousePointer2, Search, Sparkles, Workflow } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { HeroActions } from "@/components/hero-actions";
import { Receptionist } from "@/components/receptionist";
import { getN8nConfig, isN8nConfigured } from "@/lib/n8n-config";
import { sessionState } from "@/lib/auth";

export const dynamic = "force-dynamic";
const services = [
  { number: "01", icon: Code2, name: "Website Development", description: "Business websites, landing pages and e-commerce stores.", tags: "Built for your business", starter: "A stronger digital home." },
  { number: "02", icon: Layers3, name: "Social Media Marketing", description: "Content planning, account management and advertising support.", tags: "Connect with your audience", starter: "Make your presence felt." },
  { number: "03", icon: Search, name: "SEO", description: "Website audits, on-page SEO and technical improvements.", tags: "Turn searches into possibilities", starter: "Help the right people find you." },
  { number: "04", icon: Workflow, name: "AI Automation", description: "AI assistants, lead collection and business workflow automation.", tags: "Make room for what matters", starter: "Less busywork. More potential." },
];

export default async function Home() {
  const state = await sessionState(await headers());
  if (!state.authenticated) redirect("/login");
  if (!state.user) redirect("/access-denied");
  const connected = isN8nConfigured(getN8nConfig());
  return <><a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header" id="top"><div className="shell nav"><Brand /><nav aria-label="Main navigation"><a href="#services">Services</a><a href="#receptionist">Receptionist</a></nav><AccountMenu email={state.user.email} owner={state.user.owner} /></div></header>
    <main id="main">
      <section className="hero shell" aria-labelledby="hero-title"><div className="hero-copy"><div className="eyebrow"><span className="status-dot" /> BIG IDEAS START WITH A HELLO</div><h1 id="hero-title">Meet your<br />AI <span>receptionist.</span></h1><p className="hero-description">A little conversation.<br />A world of possibilities.</p><p className="hero-detail">Ask about our services, share what you’re building, or request a discovery call. Nova is here to help you take the next step.</p><HeroActions /><div className="hero-notes"><span><Check size={13} />Your words. Your pace.</span><span><Check size={13} />Voice or text</span></div>
      <div className="conversation-path"><div className="path-icons" aria-hidden="true"><span><MessageSquareIcon /></span><i /><span><Sparkles size={18} /></span><i /><span><ArrowUpRight size={19} /></span></div><p>From “I have an idea”<br /><strong>to “let’s make it happen.”</strong></p></div><a className="explore-link" href="#services"><span><ArrowDown size={14} /></span>Explore what we do</a></div>
      <div className="panel-wrap"><div className="panel-top-caption"><span>LESS FRICTION. MORE CONVERSATION.</span><AudioLines size={18} /></div><Receptionist connected={connected} /><div className="panel-bottom-caption"><span className="tiny-dot" />A real next step, at your pace.</div></div></section>
      <div className="principles-strip"><div className="shell principles-inner"><span><MousePointer2 size={17} />Simple to start</span><span><AudioLines size={18} />Speak or type</span><span><Braces size={18} />Built around your needs</span><span><Check size={18} />You stay in control</span></div></div>
      <section id="services" className="services shell" aria-labelledby="services-title"><div className="section-heading"><div><p className="eyebrow">WHAT WE CAN BUILD TOGETHER</p><h2 id="services-title">Your ambition.<br className="mobile-break" /> Our digital expertise<span>.</span></h2></div><p>From your first website to your next workflow.<br />Let’s find the right fit for your business.</p></div><div className="service-grid">{services.map(service => <article className="service-card" key={service.number}><div className="service-card-top"><span className="service-icon"><service.icon size={22} strokeWidth={1.5} /></span><span className="service-number">/{service.number}</span></div><h3>{service.name}</h3><p>{service.description}</p><div className="service-bottom"><span>{service.tags}</span><a href="#receptionist" aria-label={`Ask Nova about ${service.name}`}><ArrowUpRight size={19} /></a></div></article>)}</div><p className="pricing-note"><span className="tiny-dot" />Custom quote based on your requirements.</p></section>
      <section className="how-section shell" aria-labelledby="how-title"><div className="how-intro"><p className="eyebrow">A HUMAN PACE. AN AI ASSISTANT.</p><h2 id="how-title">Good things start<br />with a conversation.</h2><p>No long forms. Just a place to begin.</p></div><div className="steps"><div className="step"><span>01</span><div><h3>Tell Nova what’s on your mind</h3><p>Type a message or use your microphone. Review your words before sending.</p></div></div><div className="step"><span>02</span><div><h3>Explore the possibilities</h3><p>Ask about services and share your requirements. You decide which details to share.</p></div></div><div className="step"><span>03</span><div><h3>Take the next step, when you’re ready</h3><p>Request a 30-minute discovery call. Booking requires your explicit confirmation. Times default to Pakistan time (Asia/Karachi).</p></div></div></div></section>
      <section className="closing shell"><div className="closing-mark" aria-hidden="true"><Sparkles size={28} strokeWidth={1.3} /></div><div><p className="eyebrow">YOUR NEXT CHAPTER</p><h2>Have something in mind?</h2><p>Let’s turn your first question into a starting point.</p></div><a href="#receptionist" className="button button-primary">Start a conversation<ArrowRight size={17} /></a></section>
    </main><footer className="site-footer shell"><Brand small /><p>Thoughtful digital solutions. Meaningful conversations.</p><a href="#top">Back to top <ArrowUpRight size={13} /></a><div className="footer-bottom"><span>© {new Date().getFullYear()} Nova Digital</span><span>AI-assisted. You’re in control.</span></div></footer></>;
}
function MessageSquareIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>; }
