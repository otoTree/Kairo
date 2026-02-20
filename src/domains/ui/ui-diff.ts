import type { RenderNode } from './types';

/**
 * UI Diff 补丁操作类型
 */
export type PatchOp =
  | { type: 'add'; path: string; node: RenderNode }
  | { type: 'remove'; path: string }
  | { type: 'update'; path: string; props: Record<string, any> }
  | { type: 'replace'; path: string; node: RenderNode };

/**
 * 对比新旧 UI 树，生成最小化补丁操作列表
 * 基于节点 id 或位置进行匹配
 */
export function diffTree(
  oldTree: RenderNode | undefined,
  newTree: RenderNode | undefined,
  path: string = 'root'
): PatchOp[] {
  const patches: PatchOp[] = [];

  // 新增节点
  if (!oldTree && newTree) {
    patches.push({ type: 'add', path, node: newTree });
    return patches;
  }

  // 删除节点
  if (oldTree && !newTree) {
    patches.push({ type: 'remove', path });
    return patches;
  }

  // 两者都不存在
  if (!oldTree || !newTree) return patches;

  // 类型不同，整体替换
  if (oldTree.type !== newTree.type) {
    patches.push({ type: 'replace', path, node: newTree });
    return patches;
  }

  // 对比 props
  const propChanges = diffProps(oldTree.props, newTree.props);
  if (Object.keys(propChanges).length > 0) {
    patches.push({ type: 'update', path, props: propChanges });
  }

  // 对比 signals
  if (JSON.stringify(oldTree.signals) !== JSON.stringify(newTree.signals)) {
    patches.push({ type: 'update', path, props: { __signals: newTree.signals } });
  }

  // 递归对比子节点
  const oldChildren = oldTree.children || [];
  const newChildren = newTree.children || [];
  const maxLen = Math.max(oldChildren.length, newChildren.length);

  for (let i = 0; i < maxLen; i++) {
    const childPath = `${path}/${newChildren[i]?.id || oldChildren[i]?.id || i}`;
    const childPatches = diffTree(oldChildren[i], newChildren[i], childPath);
    patches.push(...childPatches);
  }

  return patches;
}

/**
 * 对比两个 props 对象，返回变化的键值对
 */
function diffProps(
  oldProps: Record<string, any>,
  newProps: Record<string, any>
): Record<string, any> {
  const changes: Record<string, any> = {};

  // 检查新增和修改的属性
  for (const key of Object.keys(newProps)) {
    if (JSON.stringify(oldProps[key]) !== JSON.stringify(newProps[key])) {
      changes[key] = newProps[key];
    }
  }

  // 检查删除的属性
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      changes[key] = undefined;
    }
  }

  return changes;
}

/**
 * 判断两棵树是否有差异
 */
export function hasChanges(oldTree?: RenderNode, newTree?: RenderNode): boolean {
  return diffTree(oldTree, newTree).length > 0;
}
