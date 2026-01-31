import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { globalBus } from './lib/event-bus'
import { kairoClient } from './lib/kairo-client'
import { cn } from './lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SendHorizontal, Sparkles, Terminal, Bot, User, BrainCircuit, Wrench, ChevronRight } from 'lucide-react'

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: number;
  agentId?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [activeAgentId, setActiveAgentId] = useState<string>(''); // '' means Auto/Router
  const [knownAgents, setKnownAgents] = useState<Set<string>>(new Set(['default']));
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    kairoClient.connect();

    const unsubConnection = globalBus.subscribe('system.connection', (event) => {
        setStatus((event.data as any).status);
    });

    const unsubThought = globalBus.subscribe('kairo.agent.thought', (event) => {
        const agentId = event.source.replace('agent:', '');
        registerAgent(agentId);
        addMessage({
            role: 'agent',
            content: `💭 ${formatPayload((event.data as any).thought)}`,
            ts: Date.now(),
            agentId
        });
    });

    const unsubAction = globalBus.subscribe('kairo.agent.action', (event) => {
        const agentId = event.source.replace('agent:', '');
        registerAgent(agentId);
        const action = (event.data as any).action;
        
        if (action.type === 'say') {
             addMessage({
                role: 'agent',
                content: action.content,
                ts: Date.now(),
                agentId
            });
        } else if (action.type === 'query') {
             addMessage({
                role: 'agent',
                content: `❓ ${action.content}`,
                ts: Date.now(),
                agentId
            });
        } else if (action.type === 'tool_call') {
             addMessage({
                role: 'system',
                content: `🛠️ Calling tool: ${action.function.name}`,
                ts: Date.now(),
                agentId
            });
        }
    });

    const unsubToolResult = globalBus.subscribe('kairo.tool.result', (event) => {
         addMessage({
            role: 'system',
            content: `✅ Tool Result:\n${formatPayload((event.data as any).result || (event.data as any).error)}`,
            ts: Date.now()
        });
    });

    return () => {
        unsubConnection();
        unsubThought();
        unsubAction();
        unsubToolResult();
    };
  }, []);

  const registerAgent = (id: string) => {
      setKnownAgents(prev => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
      });
  };

  const addMessage = (msg: Omit<Message, 'id'>) => {
      const newMsg = { ...msg, id: crypto.randomUUID() };
      setMessages(prev => [...prev, newMsg]);
  };

  useEffect(() => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const formatPayload = (payload: any): string => {
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object') return JSON.stringify(payload, null, 2);
    return String(payload);
  };

  const sendMessage = () => {
    if (!input.trim() || status !== 'connected') return;
    
    const target = activeAgentId === '' ? undefined : activeAgentId;
    
    kairoClient.send(input, target);
    
    addMessage({ 
        role: 'user', 
        content: input, 
        ts: Date.now(),
        agentId: target 
    });
    setInput('');
  };

  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hues = [0, 60, 165, 290, 200, 30]; 
    const hue = hues[Math.abs(hash) % hues.length];
    return `oklch(0.75 0.1 ${hue})`; 
  };

  const renderMessageContent = (m: Message) => {
    let content = m.content;
    
    // Thought
    if (content.startsWith('💭 ')) {
        return (
            <div className="flex flex-col gap-1.5 text-muted-foreground/70 pl-2 border-l-2 border-primary/10 my-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider opacity-50">
                    Thinking Process
                </div>
                <div className="text-sm italic opacity-80 leading-relaxed font-serif">
                    {content.substring(3)}
                </div>
            </div>
        )
    }

    // Query
    if (content.startsWith('❓ ')) {
        return (
             <div className="flex flex-col gap-1">
                 <div className="font-semibold text-primary mb-1 flex items-center gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs">?</span>
                    Question
                 </div>
                 <div className="whitespace-pre-wrap text-base">{content.substring(3)}</div>
             </div>
        )
    }

    // Tool Call
    if (content.startsWith('🛠️ Calling tool: ')) {
        const toolName = content.replace('🛠️ Calling tool: ', '');
        return (
            <div className="flex items-center gap-2 text-amber-600/90 dark:text-amber-400/90">
                <Wrench className="w-3.5 h-3.5" />
                <span className="font-semibold text-xs uppercase tracking-wide">Calling Tool</span>
                <div className="bg-amber-100/50 dark:bg-amber-900/20 px-2 py-0.5 rounded text-[10px] font-mono border border-amber-200/50">
                    {toolName}
                </div>
            </div>
        )
    }

    // Tool Result
    if (content.startsWith('✅ Tool Result:')) {
         return (
            <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 text-emerald-600/90 dark:text-emerald-400/90 border-b border-border/50 pb-2 mb-1">
                    <Terminal className="w-3.5 h-3.5" />
                    <span className="font-semibold text-xs uppercase tracking-wide">Tool Output</span>
                </div>
                <div className="relative">
                    <pre className="text-[10px] md:text-xs overflow-x-auto p-3 bg-black/5 dark:bg-white/5 rounded-md font-mono leading-normal max-h-60 custom-scrollbar">
                        {content.replace('✅ Tool Result:\n', '')}
                    </pre>
                </div>
            </div>
        )
    }

    return <div className="whitespace-pre-wrap text-sm md:text-base">{content}</div>
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background font-sans text-foreground selection:bg-primary/10 selection:text-primary">
        {/* Header - Modern & Clean */}
        <header className="flex-none py-3 px-4 md:px-6 border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between">
             <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-serif font-bold text-xl shadow-sm">
                    K
                </div>
                <div className="flex flex-col">
                    <h1 className="font-semibold text-sm tracking-tight leading-none">KAIRO</h1>
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                         <div className={cn("w-1.5 h-1.5 rounded-full transition-colors shadow-[0_0_4px_currentColor]", 
                            status === 'connected' ? "bg-emerald-500 text-emerald-500" : 
                            status === 'connecting' ? "bg-amber-500 text-amber-500" : "bg-red-500 text-red-500"
                        )} />
                        {status}
                    </div>
                </div>
             </div>
             
             {/* Agent Selector */}
             <div className="flex items-center bg-secondary/50 hover:bg-secondary/80 transition-colors rounded-lg px-2 py-1.5 border border-border/50">
                <Sparkles className="w-3.5 h-3.5 text-muted-foreground mr-2" />
                <select 
                    value={activeAgentId} 
                    onChange={e => setActiveAgentId(e.target.value)}
                    className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer appearance-none pr-6 relative z-10"
                >
                    <option value="">Auto Route</option>
                    {Array.from(knownAgents).map(id => (
                        <option key={id} value={id}>{id === 'default' ? 'Main Agent' : id}</option>
                    ))}
                </select>
                <ChevronRight className="w-3 h-3 text-muted-foreground absolute right-2 pointer-events-none opacity-50 rotate-90" />
             </div>
        </header>

        {/* Main Chat Area */}
        <main className="flex-1 overflow-hidden relative flex flex-col bg-muted/5">
             <ScrollArea className="flex-1 px-2 md:px-0" ref={scrollAreaRef}>
                <div className="max-w-3xl mx-auto w-full py-6 px-2 md:px-6 flex flex-col gap-6">
                    <AnimatePresence initial={false}>
                        {messages.length === 0 && (
                             <div className="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                                <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                    <Bot className="w-10 h-10 text-muted-foreground" />
                                </div>
                                <p className="text-sm font-medium text-muted-foreground">Kairo is ready to help.</p>
                             </div>
                        )}
                        {messages.map((m, i) => {
                            const isSequence = i > 0 && messages[i-1].role === m.role && messages[i-1].agentId === m.agentId;
                            
                            return (
                            <motion.div 
                                key={m.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={cn(
                                    "flex gap-3 md:gap-4 w-full group",
                                    m.role === 'user' ? "flex-row-reverse" : "flex-row",
                                    isSequence ? "mt-2" : ""
                                )}
                            >
                                {/* Avatar */}
                                <Avatar className={cn(
                                    "w-8 h-8 mt-0.5 border shadow-sm transition-transform group-hover:scale-105",
                                    m.role === 'user' ? "border-primary/20" : "border-border",
                                    isSequence ? "invisible" : ""
                                )}>
                                    <AvatarFallback className={cn(
                                        "text-[10px] font-bold",
                                        m.role === 'user' ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                                    )}
                                    style={m.role === 'agent' && m.agentId ? { color: stringToColor(m.agentId) } : {}}
                                    >
                                        {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                    </AvatarFallback>
                                </Avatar>

                                {/* Message Content */}
                                <div className={cn(
                                    "flex flex-col gap-1 max-w-[85%] md:max-w-[80%]",
                                    m.role === 'user' ? "items-end" : "items-start"
                                )}>
                                    {!isSequence && (
                                        <div className="flex items-center gap-2 px-1">
                                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                                {m.role === 'user' ? 'You' : (m.agentId === 'default' ? 'Kairo' : (m.agentId || 'Kairo'))}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                                                {new Date(m.ts).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </span>
                                        </div>
                                    )}

                                    {/* Bubble / Card */}
                                    <div className={cn(
                                        "relative transition-all duration-200",
                                        m.role === 'user' 
                                            ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm" 
                                            : m.role === 'agent'
                                                ? m.content.startsWith('💭 ')
                                                    ? "px-0 py-1 w-full" // Thinking process: no bubble
                                                    : "bg-card border border-border/60 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm hover:shadow-md hover:border-border/80"
                                                : "bg-muted/30 border border-border/50 rounded-xl px-4 py-3 w-full shadow-sm"
                                    )}>
                                        {renderMessageContent(m)}
                                    </div>
                                </div>
                            </motion.div>
                            );
                        })}
                    </AnimatePresence>
                    <div ref={messagesEndRef} className="h-4" />
                </div>
             </ScrollArea>

             {/* Input Area */}
             <div className="p-4 md:p-6 bg-background/80 backdrop-blur-xl border-t border-border/40 z-20">
                <div className="max-w-3xl mx-auto w-full relative">
                    <div className={cn(
                        "relative flex items-center gap-2 bg-muted/40 border border-border/50 rounded-2xl px-4 py-3 shadow-sm transition-all duration-200",
                        "focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/10 focus-within:border-primary/20 focus-within:shadow-md"
                    )}>
                        <input 
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && sendMessage()}
                            placeholder="Type a message to Kairo..."
                            className="flex-1 bg-transparent border-none focus:ring-0 placeholder:text-muted-foreground/50 text-sm md:text-base py-0.5"
                            disabled={status !== 'connected'}
                        />
                        <Button 
                            size="icon" 
                            variant={input.trim() ? "default" : "ghost"}
                            className={cn("h-8 w-8 rounded-xl transition-all duration-200", input.trim() ? "opacity-100 scale-100" : "opacity-50 scale-90 hover:bg-transparent")}
                            onClick={sendMessage}
                            disabled={status !== 'connected' || !input.trim()}
                        >
                            <SendHorizontal className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
             </div>
        </main>
    </div>
  )
}

export default App
