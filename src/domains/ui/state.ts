/**
 * UI 交互状态管理
 *
 * 追踪 Hover / Active / Focus / Selected 状态，
 * 供窗口构建器查询当前元素状态以决定渲染样式。
 */

/** 元素交互状态 */
export interface ElementState {
  hover: boolean;
  active: boolean;   // 鼠标按下中
  focused: boolean;
  selected: boolean;
}

const DEFAULT_STATE: ElementState = {
  hover: false,
  active: false,
  focused: false,
  selected: false,
};

/**
 * 交互状态管理器
 *
 * 每个 Surface 维护一个实例，通过元素 ID 追踪状态。
 * 状态变更时触发回调，窗口可据此决定是否重绘。
 */
export class InteractionState {
  private states = new Map<string, ElementState>();
  private onChange?: (elementId: string, state: ElementState) => void;

  /** 当前获得焦点的元素 ID */
  focusedId: string | null = null;
  /** 当前 hover 的元素 ID */
  hoveredId: string | null = null;

  constructor(onChange?: (elementId: string, state: ElementState) => void) {
    this.onChange = onChange;
  }

  /** 获取元素状态（不存在则返回默认值） */
  get(elementId: string): ElementState {
    return this.states.get(elementId) ?? { ...DEFAULT_STATE };
  }

  /** 设置 hover 状态（自动清除上一个 hover 元素） */
  setHover(elementId: string | null): boolean {
    let changed = false;

    // 清除旧 hover
    if (this.hoveredId && this.hoveredId !== elementId) {
      changed = this.update(this.hoveredId, { hover: false }) || changed;
    }

    // 设置新 hover
    if (elementId) {
      changed = this.update(elementId, { hover: true }) || changed;
    }

    this.hoveredId = elementId;
    return changed;
  }

  /** 设置焦点（自动清除上一个焦点元素） */
  setFocus(elementId: string | null): boolean {
    let changed = false;

    if (this.focusedId && this.focusedId !== elementId) {
      changed = this.update(this.focusedId, { focused: false }) || changed;
    }

    if (elementId) {
      changed = this.update(elementId, { focused: true }) || changed;
    }

    this.focusedId = elementId;
    return changed;
  }

  /** 设置 active 状态（鼠标按下） */
  setActive(elementId: string, active: boolean): boolean {
    return this.update(elementId, { active });
  }

  /** 设置选中状态 */
  setSelected(elementId: string, selected: boolean): boolean {
    return this.update(elementId, { selected });
  }

  /** 清除所有选中状态 */
  clearSelection(): void {
    for (const [id, state] of this.states) {
      if (state.selected) {
        this.update(id, { selected: false });
      }
    }
  }

  /** 重置所有状态 */
  reset(): void {
    this.states.clear();
    this.focusedId = null;
    this.hoveredId = null;
  }

  /** 更新元素部分状态，返回是否有变化 */
  private update(elementId: string, partial: Partial<ElementState>): boolean {
    const current = this.states.get(elementId) ?? { ...DEFAULT_STATE };
    let changed = false;

    for (const [key, value] of Object.entries(partial)) {
      if (current[key as keyof ElementState] !== value) {
        (current as any)[key] = value;
        changed = true;
      }
    }

    if (changed) {
      this.states.set(elementId, current);
      this.onChange?.(elementId, current);
    }

    return changed;
  }
}
