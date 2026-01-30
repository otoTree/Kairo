import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: number;
}

interface LogEntry {
  type: string;
  message: string;
  data?: any;
  ts: number;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Prevent duplicate connections in StrictMode
    if (wsRef.current) return;
    
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const formatPayload = (payload: any): string => {
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object') return JSON.stringify(payload, null, 2);
    return String(payload);
  };

  const connect = () => {
    setStatus('connecting');
    // Connect to backend (assuming localhost:3000)
    const ws = new WebSocket('ws://localhost:3000/ws');
    
    ws.onopen = () => {
      setStatus('connected');
      console.log('Connected to Agent Server');
      setMessages(prev => [...prev, { role: 'system', content: 'Connected to Agent', ts: Date.now() }]);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received:', data);
        
        if (data.type === 'agent_action') {
            const action = data.action;
            if (action.type === 'say') {
                setMessages(prev => [...prev, { role: 'agent', content: formatPayload(action.payload), ts: Date.now() }]);
            } else if (action.type === 'query') {
                setMessages(prev => [...prev, { role: 'agent', content: `❓ ${formatPayload(action.payload)}`, ts: Date.now() }]);
            } else if (action.type === 'tool_call') {
                 setMessages(prev => [...prev, { role: 'system', content: `🛠️ Calling tool: ${action.payload.name}`, ts: Date.now() }]);
            }
        } else if (data.type === 'agent_log') {
            setLogs(prev => [...prev, data.log]);
        } else if (data.type === 'agent_action_result') {
            const { action, result } = data.result;
            setMessages(prev => [...prev, { 
                role: 'system', 
                content: `✅ Tool Result (${action.payload.name}):\n${formatPayload(result)}`, 
                ts: Date.now() 
            }]);
        }
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      console.log('Disconnected');
      // Only reconnect if we don't have an active connection (handling cleanup race conditions)
      if (wsRef.current === ws) {
          setMessages(prev => [...prev, { role: 'system', content: 'Disconnected. Reconnecting in 3s...', ts: Date.now() }]);
          wsRef.current = null;
          setTimeout(connect, 3000);
      }
    };

    wsRef.current = ws;
  };

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current) return;
    
    const msg = {
        type: 'user_message',
        text: input
    };
    
    wsRef.current.send(JSON.stringify(msg));
    setMessages(prev => [...prev, { role: 'user', content: input, ts: Date.now() }]);
    setInput('');
  };

  return (
    <div className="container">
      <header>
        <h1>Kairo Agent</h1>
        <span className={`status ${status}`}>{status}</span>
      </header>
      
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="content">{m.content}</div>
            <div className="meta">{new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <input 
          value={input} 
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Say something to the agent..."
          disabled={status !== 'connected'}
        />
        <button onClick={sendMessage} disabled={status !== 'connected'}>Send</button>
      </div>
    </div>
  )
}

export default App
