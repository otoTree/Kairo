import { useState, useEffect } from 'react';
import { globalBus } from '@/lib/event-bus';
import { RenderTree } from './RenderTree';
import type { SurfaceState } from '@/lib/kdp';

export function Compositor() {
  const [surfaces, setSurfaces] = useState<Map<string, SurfaceState>>(new Map());

  useEffect(() => {
    const unsub = globalBus.subscribe('kairo.agent.render.commit', (event: any) => {
      const { surfaceId, tree } = event.data;
      setSurfaces(prev => {
        const next = new Map(prev);
        // Ensure we preserve geometry if it exists, or set default
        const existing = next.get(surfaceId);
        next.set(surfaceId, {
          id: surfaceId,
          tree,
          visible: true,
          geometry: existing?.geometry || { x: 0, y: 0, width: 300, height: 200 }
        });
        return next;
      });
    });

    return () => unsub();
  }, []);

  if (surfaces.size === 0) return null;

  return (
    <div className="fixed top-4 right-4 flex flex-col gap-4 w-80 max-h-[calc(100vh-2rem)] z-50 pointer-events-none">
       {Array.from(surfaces.values()).map(surface => (
         <div key={surface.id} className="bg-background border rounded-lg shadow-lg pointer-events-auto flex flex-col overflow-hidden animate-in slide-in-from-right-10 fade-in duration-300">
            <div className="bg-muted px-3 py-1 text-xs font-mono border-b flex justify-between items-center h-8">
                <span className="truncate font-semibold">{surface.id}</span>
                <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400 hover:bg-red-500 cursor-pointer" onClick={() => {
                        setSurfaces(prev => {
                            const next = new Map(prev);
                            next.delete(surface.id);
                            return next;
                        });
                    }}/>
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
            </div>
            <div className="p-4 bg-card">
                {surface.tree && <RenderTree node={surface.tree} surfaceId={surface.id} />}
            </div>
         </div>
       ))}
    </div>
  );
}
