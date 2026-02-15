import { CheckpointRepository, type CheckpointData } from '../database/repositories/checkpoint-repository';
import type { StateRepository } from '../database/repositories/state-repository';
import { randomUUID } from 'crypto';

export class KernelStateManager {
    constructor(
        private stateRepo: StateRepository,
        private checkpointRepo: CheckpointRepository,
    ) {}
    
    async saveCheckpoint(): Promise<string> {
        const processes = await this.stateRepo.getByPrefix<any>('process:');
        const claims = await this.stateRepo.getByPrefix<any>('device:claim:');
        
        const checkpointId = randomUUID();
        
        const data: CheckpointData = {
            processes: processes.map((p: any) => p.value),
            devices: claims.map((c: any) => c.value),
            // eventLogOffset: TODO
        };
        
        await this.checkpointRepo.save(checkpointId, data);
        console.log(`[KernelState] Saved checkpoint ${checkpointId}`);
        return checkpointId;
    }
    
    async restoreCheckpoint(id: string) {
        const checkpoint = await this.checkpointRepo.get(id);
        if (!checkpoint) throw new Error(`Checkpoint ${id} not found`);
        
        // Clear current state
        await this.stateRepo.deleteByPrefix('process:');
        await this.stateRepo.deleteByPrefix('device:claim:');
        
        // Insert new state
        for (const p of checkpoint.processes) {
            await this.stateRepo.save(`process:${p.id}`, p);
        }
        for (const d of checkpoint.devices) {
            await this.stateRepo.save(`device:claim:${d.deviceId}`, d);
        }
        
        console.log(`[KernelState] Restored checkpoint ${id}. Restart Kernel to apply.`);
    }
}
