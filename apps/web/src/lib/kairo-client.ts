import { globalBus } from './event-bus';

export class KairoClient {
    private ws: WebSocket | null = null;
    private reconnectTimer: any = null;
    private url: string;

    constructor() {
        // Determine URL based on environment
        if (import.meta.env.DEV) {
             this.url = `ws://localhost:3000/ws`;
        } else {
             // Production: relative to host
             const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
             this.url = `${protocol}//${window.location.host}/ws`;
        }
    }

    connect() {
        if (this.ws) return;

        console.log('KairoClient: Connecting to', this.url);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log('KairoClient: Connected');
            globalBus.publish({
                type: 'system.connection',
                source: 'client:web',
                data: { status: 'connected' }
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleIncomingMessage(data);
            } catch (e) {
                console.error('KairoClient: Failed to parse message', e);
            }
        };

        this.ws.onclose = () => {
            console.log('KairoClient: Disconnected');
            this.ws = null;
             globalBus.publish({
                type: 'system.connection',
                source: 'client:web',
                data: { status: 'disconnected' }
            });
            // Reconnect logic
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        };
        
        this.ws.onerror = (err) => {
            console.error('KairoClient: WebSocket error', err);
        };
    }

    private handleIncomingMessage(data: any) {
        // If it's already a KairoEvent (has specversion 1.0), dispatch directly
        if (data.specversion === '1.0') {
            globalBus.dispatch(data);
            return;
        }

        // Legacy adapter
        const agentId = data.agentId || 'default'; // Assuming backend might add agentId eventually

        if (data.type === 'agent_action') {
            // data.action = { type: 'say' | 'tool_call', payload: ... }
            const action = data.action;
            
            if (action.type === 'say') {
                globalBus.publish({
                    type: `agent.${agentId}.thought`, 
                    source: `agent:${agentId}`,
                    data: { content: action.payload }
                });
            } else if (action.type === 'tool_call') {
                 globalBus.publish({
                    type: `tool.${action.payload.name}.invoke`, 
                    source: `agent:${agentId}`,
                    data: action.payload
                });
            } else if (action.type === 'query') {
                globalBus.publish({
                    type: `agent.${agentId}.query`,
                    source: `agent:${agentId}`,
                    data: { content: action.payload }
                });
            }
        } else if (data.type === 'agent_log') {
             globalBus.publish({
                type: 'system.log',
                source: 'backend',
                data: data.log
            });
        } else if (data.type === 'agent_action_result') {
            globalBus.publish({
                type: `tool.unknown.result`, 
                source: `tool:unknown`,
                data: data.result
            });
        }
    }

    send(message: string, agentId?: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'user_input',
                content: message,
                agentId: agentId // Optional target
            }));
        } else {
            console.warn('KairoClient: WebSocket not connected, cannot send message');
        }
    }
}

export const kairoClient = new KairoClient();
