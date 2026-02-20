import { describe, it, expect, beforeEach } from 'bun:test';
import { diffTree, hasChanges } from './ui-diff';
import type { RenderNode } from './types';

describe('UI Diff 算法', () => {
  it('应检测新增节点', () => {
    const patches = diffTree(undefined, {
      type: 'Button', id: 'btn1', props: { label: 'Click' },
    });
    expect(patches.length).toBe(1);
    expect(patches[0].type).toBe('add');
  });

  it('应检测删除节点', () => {
    const patches = diffTree(
      { type: 'Button', id: 'btn1', props: { label: 'Click' } },
      undefined,
    );
    expect(patches.length).toBe(1);
    expect(patches[0].type).toBe('remove');
  });

  it('应检测类型变更（整体替换）', () => {
    const patches = diffTree(
      { type: 'Button', props: { label: 'A' } },
      { type: 'Text', props: { text: 'B' } },
    );
    expect(patches.length).toBe(1);
    expect(patches[0].type).toBe('replace');
  });

  it('应检测 props 变更', () => {
    const patches = diffTree(
      { type: 'Button', props: { label: 'Old' } },
      { type: 'Button', props: { label: 'New' } },
    );
    expect(patches.length).toBe(1);
    expect(patches[0].type).toBe('update');
  });

  it('应检测子节点变更', () => {
    const oldTree: RenderNode = {
      type: 'Column', props: {},
      children: [
        { type: 'Text', id: 'a', props: { text: 'Hello' } },
      ],
    };
    const newTree: RenderNode = {
      type: 'Column', props: {},
      children: [
        { type: 'Text', id: 'a', props: { text: 'Hello' } },
        { type: 'Button', id: 'b', props: { label: 'New' } },
      ],
    };

    const patches = diffTree(oldTree, newTree);
    // 应有一个 add 操作（新增 Button）
    const addPatch = patches.find(p => p.type === 'add');
    expect(addPatch).toBeDefined();
  });

  it('相同树应无差异', () => {
    const tree: RenderNode = {
      type: 'Column', props: {},
      children: [{ type: 'Text', props: { text: 'Same' } }],
    };
    expect(hasChanges(tree, tree)).toBe(false);
  });
});

describe('Compositor 信号路由', () => {
  it('应将信号路由到对应 Agent', async () => {
    // 模拟 EventBus
    const published: any[] = [];
    const mockBus = {
      subscribe: (_topic: string, _handler: any) => {},
      publish: (event: any) => { published.push(event); return Promise.resolve(''); },
    };

    // 直接测试路由逻辑
    const { CompositorPlugin } = await import('./compositor.plugin');
    const compositor = new CompositorPlugin();

    // 手动注入状态
    (compositor as any).eventBus = mockBus;
    (compositor as any).surfaces = new Map([
      ['surface-1', {
        id: 'surface-1',
        agentId: 'agent-alpha',
        title: 'Test',
        visible: true,
        tree: {
          type: 'Column', props: {},
          children: [
            { type: 'Button', id: 'btn1', props: {}, signals: { clicked: 'do_action' } },
          ],
        },
      }],
    ]);

    // 模拟信号
    (compositor as any).handleSignal({
      data: {
        surfaceId: 'surface-1',
        signal: 'clicked',
        slot: 'do_action',
        args: [],
      },
    });

    // 验证路由到了正确的 Agent
    expect(published.length).toBe(1);
    expect(published[0].type).toBe('kairo.agent.agent-alpha.ui.signal');
    expect(published[0].data.slot).toBe('do_action');
  });

  it('应将 KDP user_action 转换为 Agent 信号', async () => {
    const published: any[] = [];
    const mockBus = {
      subscribe: () => {},
      publish: (event: any) => { published.push(event); return Promise.resolve(''); },
    };

    const { CompositorPlugin } = await import('./compositor.plugin');
    const compositor = new CompositorPlugin();

    (compositor as any).eventBus = mockBus;
    (compositor as any).surfaces = new Map([
      ['surface-2', {
        id: 'surface-2',
        agentId: 'agent-beta',
        title: 'Test',
        visible: true,
      }],
    ]);

    (compositor as any).handleUserAction({
      data: {
        surfaceId: 'surface-2',
        elementId: 'deploy_btn',
        actionType: 'click',
        payload: {},
      },
    });

    expect(published.length).toBe(1);
    expect(published[0].type).toBe('kairo.agent.agent-beta.ui.signal');
    expect(published[0].data.signal).toBe('click');
    expect(published[0].data.slot).toBe('deploy_btn');
  });
});
