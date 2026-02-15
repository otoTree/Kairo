import React from 'react';
import type { RenderNode } from '../../lib/kdp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { kairoClient } from '@/lib/kairo-client';

interface RenderTreeProps {
  node: RenderNode;
  surfaceId: string;
}

export const RenderTree: React.FC<RenderTreeProps> = ({ node, surfaceId }) => {
  const handleSignal = (signal: string, args: any[] = []) => {
    if (node.signals && node.signals[signal]) {
      const slot = node.signals[signal];
      kairoClient.sendRaw({
        type: 'ui_signal',
        payload: {
          surfaceId,
          signal,
          slot,
          args
        }
      });
    }
  };

  switch (node.type) {
    case 'Column':
      return (
        <div className="flex flex-col gap-2 p-2 border rounded-md" {...node.props}>
          {node.children?.map((child, i) => (
            <RenderTree key={i} node={child} surfaceId={surfaceId} />
          ))}
        </div>
      );
    case 'Row':
      return (
        <div className="flex flex-row gap-2 p-2 border rounded-md items-center" {...node.props}>
          {node.children?.map((child, i) => (
            <RenderTree key={i} node={child} surfaceId={surfaceId} />
          ))}
        </div>
      );
    case 'Text':
      return <span className="text-sm" {...node.props}>{node.props.text}</span>;
    case 'Button':
      return (
        <Button 
          variant="secondary" 
          size="sm" 
          onClick={() => handleSignal('clicked')}
          {...node.props}
        >
          {node.props.label || 'Button'}
        </Button>
      );
    case 'TextInput':
      return (
        <Input 
          placeholder={node.props.placeholder} 
          onChange={(e) => handleSignal('textChanged', [e.target.value])}
          {...node.props}
        />
      );
    default:
      return <div className="text-red-500 text-xs">Unknown Node: {node.type}</div>;
  }
};
